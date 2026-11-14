package main

import (
	"net/url"
	"strings"
	"sync"
	"sync/atomic"

	amodels "github.com/abhinavxd/libredesk/internal/auth/models"
	"github.com/abhinavxd/libredesk/internal/ws"
	wsmodels "github.com/abhinavxd/libredesk/internal/ws/models"
	"github.com/fasthttp/websocket"
	"github.com/valyala/fasthttp"
	"github.com/zerodha/fastglue"
)

var wsWriteBufferPool = &sync.Pool{}

// agentUpgrader: same-origin only, with loopback allowed for dev.
var agentUpgrader = websocket.FastHTTPUpgrader{
	ReadBufferSize:  8192,
	WriteBufferSize: 8192,
	WriteBufferPool: wsWriteBufferPool,
	CheckOrigin: func(ctx *fasthttp.RequestCtx) bool {
		return agentWSOriginAllowed(string(ctx.Request.Header.Peek("Origin")), string(ctx.Request.Host()), wsAnyLocalhost.Load())
	},
	Error: ErrHandler,
}

// widgetUpgrader: cross-origin by design.
var widgetUpgrader = websocket.FastHTTPUpgrader{
	ReadBufferSize:  8192,
	WriteBufferSize: 8192,
	WriteBufferPool: wsWriteBufferPool,
	CheckOrigin: func(ctx *fasthttp.RequestCtx) bool {
		return true
	},
	Error: ErrHandler,
}

// ErrHandler writes the handshake failure response.
func ErrHandler(ctx *fasthttp.RequestCtx, status int, reason error) {
	ctx.Error(reason.Error(), status)
}

// handleWS handles the websocket connection.
func handleWS(r *fastglue.Request, hub *ws.Hub) error {
	var (
		auser = r.RequestCtx.UserValue("user").(amodels.User)
		app   = r.Context.(*App)
	)
	err := agentUpgrader.Upgrade(r.RequestCtx, func(conn *websocket.Conn) {
		c := ws.Client{
			ID:   auser.ID,
			Hub:  hub,
			Conn: conn,
			Send: make(chan wsmodels.WSMessage, 128),
		}
		hub.AddClient(&c)
		go c.Listen()
		c.Serve()
	})
	if err != nil {
		app.lo.Error("error upgrading tcp connection", "user_id", auser.ID, "error", err)
	}
	return nil
}

// wsAnyLocalhost lets any localhost page open the agent websocket: only with app.env = "dev"
// (a frontend dev server on another port). In production any local page (another app on the
// agent's machine) could otherwise ride their session.
var wsAnyLocalhost atomic.Bool

// agentWSOriginAllowed says whether a page at origin may open the agent websocket on host: the
// same host only (https, or http on localhost), or any localhost origin in dev.
func agentWSOriginAllowed(origin, host string, anyLocalhost bool) bool {
	if origin == "" {
		return false
	}
	u, err := url.Parse(origin)
	if err != nil || u.Host == "" {
		return false
	}
	isLocalhost := u.Hostname() == "localhost"
	if u.Scheme != "https" && !isLocalhost {
		return false
	}
	if strings.EqualFold(u.Host, host) {
		return true
	}
	return anyLocalhost && isLocalhost
}
