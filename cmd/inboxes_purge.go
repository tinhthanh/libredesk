package main

import (
	"errors"
	"strconv"

	amodels "github.com/abhinavxd/libredesk/internal/auth/models"
	"github.com/abhinavxd/libredesk/internal/envelope"
	"github.com/abhinavxd/libredesk/internal/inboxpurge"
	"github.com/valyala/fasthttp"
	"github.com/zerodha/fastglue"
)

// handlePurgeInbox deletes an inbox for good (omnichannel): its conversations, messages, files and
// the contacts only it talks to, after archiving them (internal/inboxpurge). The omnichannel
// gateway calls it when a channel account is deleted; upstream's DELETE stays a soft delete.
func handlePurgeInbox(r *fastglue.Request) error {
	var (
		app   = r.Context.(*App)
		auser = r.RequestCtx.UserValue("user").(amodels.User)
	)
	id, err := strconv.Atoi(r.RequestCtx.UserValue("id").(string))
	if err != nil || id <= 0 {
		return r.SendErrorEnvelope(fasthttp.StatusBadRequest, app.i18n.T("globals.messages.somethingWentWrong"), nil, envelope.InputError)
	}

	app.lo.Info("purging inbox", "id", id, "actor_id", auser.ID)
	res, err := app.inboxPurge.Purge(r.RequestCtx, id)
	switch {
	case errors.Is(err, inboxpurge.ErrNotFound):
		return r.SendErrorEnvelope(fasthttp.StatusNotFound, app.i18n.T("globals.messages.somethingWentWrong"), nil, envelope.NotFoundError)
	case err != nil:
		app.lo.Error("error purging inbox", "id", id, "error", err)
		return r.SendErrorEnvelope(fasthttp.StatusInternalServerError, app.i18n.T("globals.messages.somethingWentWrong"), nil, envelope.GeneralError)
	}

	// The receiver (live chat websockets) of an inbox that no longer exists is stopped.
	if err := reloadInbox(app, id); err != nil {
		app.lo.Error("error reloading purged inbox", "id", id, "error", err)
	}
	return r.SendEnvelope(res)
}
