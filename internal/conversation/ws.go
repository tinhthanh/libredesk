package conversation

import (
	"encoding/json"
	"time"

	cmodels "github.com/abhinavxd/libredesk/internal/conversation/models"
	"github.com/abhinavxd/libredesk/internal/inbox"
	"github.com/abhinavxd/libredesk/internal/inbox/channel/livechat"
	"github.com/abhinavxd/libredesk/internal/ws"
	wsmodels "github.com/abhinavxd/libredesk/internal/ws/models"
)

// broadcastConv shadows the per-user fields (another agent's unread state) out of the shared payload.
type broadcastConv struct {
	*cmodels.ConversationListItem
	UnreadMessageCount   *struct{} `json:"unread_message_count,omitempty"`
	MentionedMessageUUID *struct{} `json:"mentioned_message_uuid,omitempty"`
}

func (m *Manager) BroadcastNewConversation(conv *cmodels.ConversationListItem) {
	m.broadcastConvToAuthorized(conv, nil)
}

// BroadcastConvReassignment notifies the union of agents authorized under old and new assignee state, so agents losing access receive the updated payload and their frontend can filter the conv out.
func (m *Manager) BroadcastConvReassignment(oldConv, newConv *cmodels.ConversationListItem) {
	m.broadcastConvToAuthorized(newConv, oldConv)
}

func (m *Manager) BroadcastNewMessage(message *cmodels.Message, conv *cmodels.ConversationListItem, preview string) {
	if conv == nil {
		return
	}
	data := map[string]any{
		"conversation_uuid": message.ConversationUUID,
		"uuid":              message.UUID,
		"type":              message.Type,
		"preview":           preview,
		"created_at":        wsTime(message.CreatedAt),
		"sender_type":       message.SenderType,
		"conversation":      convToBroadcast(conv),
	}

	for k, v := range wsMetaFields(message.Meta) {
		data[k] = v
	}

	userIDs := m.AuthorizedConnectedAgentIDs(conv.AssignedUserID, conv.AssignedTeamID)
	if len(userIDs) == 0 {
		return
	}
	m.broadcastToUsers(userIDs, wsmodels.Message{
		Type: wsmodels.MessageTypeNewMessage,
		Data: data,
	})
}

// BroadcastMessageUpdate broadcasts a partial message update to list subscribers.
func (m *Manager) BroadcastMessageUpdate(conversationUUID, messageUUID string, data map[string]any) {
	data["conversation_uuid"] = conversationUUID
	data["uuid"] = messageUUID
	m.broadcastToConversationListSubs(conversationUUID, wsmodels.Message{
		Type: wsmodels.MessageTypeMessageUpdate,
		Data: data,
	})
}

// BroadcastConversationUpdate broadcasts a partial conversation update to list subscribers.
func (m *Manager) BroadcastConversationUpdate(conversationUUID string, data map[string]any) {
	data["uuid"] = conversationUUID
	m.broadcastToConversationListSubs(conversationUUID, wsmodels.Message{
		Type: wsmodels.MessageTypeConversationUpdate,
		Data: data,
	})
}

func (m *Manager) BroadcastContactUpdate(contactID int, data map[string]any) {
	data["contact_id"] = contactID
	var uuids []string
	if err := m.q.GetConversationUUIDsByContact.Select(&uuids, contactID); err != nil {
		m.lo.Error("error fetching contact's conversations for broadcast", "contact_id", contactID, "error", err)
		return
	}
	if len(uuids) == 0 {
		return
	}
	seen := map[*ws.Client]struct{}{}
	for _, uuid := range uuids {
		for _, c := range m.wsHub.ListSubscribers(uuid) {
			seen[c] = struct{}{}
		}
	}
	if len(seen) == 0 {
		return
	}
	clients := make([]*ws.Client, 0, len(seen))
	for c := range seen {
		clients = append(clients, c)
	}
	messageBytes, err := json.Marshal(wsmodels.Message{
		Type: "contact_update",
		Data: data,
	})
	if err != nil {
		m.lo.Error("error marshalling contact_update WS message", "error", err)
		return
	}
	m.wsHub.PushToClients(clients, messageBytes)
}

// BroadcastTypingToConversation broadcasts typing status to all subscribers of a conversation.
// Set broadcastToWidgets to false when the typing event originates from a widget client to avoid echo.
func (m *Manager) BroadcastTypingToConversation(conversationUUID string, isTyping bool, broadcastToWidgets bool) {
	message := wsmodels.Message{
		Type: wsmodels.MessageTypeTyping,
		Data: map[string]any{
			"conversation_uuid": conversationUUID,
			"is_typing":         isTyping,
		},
	}

	messageBytes, err := json.Marshal(message)
	if err != nil {
		m.lo.Error("error marshalling typing WS message", "error", err)
		return
	}

	// Always broadcast to agent clients (main app WebSocket clients)
	m.wsHub.BroadcastTypingToAllConversationClients(conversationUUID, messageBytes)

	// Broadcast to widget clients (customers) only if this typing event comes from agents
	if broadcastToWidgets {
		m.broadcastTypingToWidgetClients(conversationUUID, isTyping)
	}
}

// BroadcastTypingToWidgetClientsOnly broadcasts typing status only to widget clients.
func (m *Manager) BroadcastTypingToWidgetClientsOnly(conversationUUID string, isTyping bool) {
	m.broadcastTypingToWidgetClients(conversationUUID, isTyping)
}

func (m *Manager) broadcastConvToAuthorized(conv, oldConv *cmodels.ConversationListItem) {
	if conv == nil {
		return
	}
	userIDs := m.AuthorizedConnectedAgentIDs(conv.AssignedUserID, conv.AssignedTeamID)
	if oldConv != nil {
		seen := make(map[int]struct{}, len(userIDs))
		for _, id := range userIDs {
			seen[id] = struct{}{}
		}
		for _, id := range m.AuthorizedConnectedAgentIDs(oldConv.AssignedUserID, oldConv.AssignedTeamID) {
			if _, ok := seen[id]; !ok {
				seen[id] = struct{}{}
				userIDs = append(userIDs, id)
			}
		}
	}
	if len(userIDs) == 0 {
		return
	}
	m.broadcastToUsers(userIDs, wsmodels.Message{
		Type: wsmodels.MessageTypeNewConversation,
		Data: convToBroadcast(conv),
	})
}

// broadcastToUsers broadcasts a message to a list of users, if the list is empty it broadcasts to all users.
func (m *Manager) broadcastToUsers(userIDs []int, message wsmodels.Message) {
	messageBytes, err := json.Marshal(message)
	if err != nil {
		m.lo.Error("error marshalling WS message", "error", err)
		return
	}
	m.wsHub.BroadcastMessage(wsmodels.BroadcastMessage{
		Data:  messageBytes,
		Users: userIDs,
	})
}

// broadcastToConversationListSubs pushes a message to the conversation's list and open subscribers.
func (m *Manager) broadcastToConversationListSubs(conversationUUID string, message wsmodels.Message) {
	clients := m.wsHub.ListSubscribers(conversationUUID)
	if len(clients) == 0 {
		return
	}
	messageBytes, err := json.Marshal(message)
	if err != nil {
		m.lo.Error("error marshalling WS message", "error", err)
		return
	}
	m.wsHub.PushToClients(clients, messageBytes)
}

// broadcastTypingToWidgetClients broadcasts typing status to widget clients (customers) for a conversation.
func (m *Manager) broadcastTypingToWidgetClients(conversationUUID string, isTyping bool) {
	conversation, err := m.GetConversation(0, conversationUUID, "")
	if err != nil {
		m.lo.Error("error getting conversation for widget typing broadcast", "error", err, "conversation_uuid", conversationUUID)
		return
	}

	inboxInstance, err := m.inboxStore.Get(conversation.InboxID)
	if err != nil {
		m.lo.Error("error getting inbox for widget typing broadcast", "error", err, "inbox_id", conversation.InboxID)
		return
	}

	if liveChatInbox, ok := inboxInstance.(*livechat.LiveChat); ok {
		liveChatInbox.BroadcastTypingToClients(conversationUUID, conversation.ContactID, isTyping)
	}
}

func (m *Manager) BroadcastAgentAvailability(agentID int, status string) {
	m.broadcastToUsers([]int{}, wsmodels.Message{
		Type: wsmodels.MessageTypeAgentAvailability,
		Data: map[string]any{
			"agent_id":            agentID,
			"availability_status": status,
		},
	})

	// Get all recent live chat conversations for this agent and broadcast the availability update to online widgets.
	var conversations []struct {
		UUID      string `db:"uuid"`
		ContactID int    `db:"contact_id"`
		InboxID   int    `db:"inbox_id"`
	}
	if err := m.q.GetActiveLivechatConversationsByAgent.Select(&conversations, agentID); err != nil {
		m.lo.Error("error fetching active livechat conversations for agent", "error", err, "agent_id", agentID)
		return
	}
	for _, conv := range conversations {
		m.BroadcastConversationToWidget(conv.UUID, conv.ContactID, conv.InboxID, map[string]any{
			"assignee": map[string]any{"availability_status": status},
		})
	}
}

// BroadcastConversationToWidget broadcasts a partial conversation update to widget clients.
func (m *Manager) BroadcastConversationToWidget(conversationUUID string, contactID, inboxID int, data map[string]any) {
	inboxInstance, err := m.inboxStore.Get(inboxID)
	if err != nil {
		if err == inbox.ErrInboxNotFound {
			return
		}
		m.lo.Error("error getting inbox for widget conversation broadcast", "error", err, "inbox_id", inboxID)
		return
	}

	if liveChatInbox, ok := inboxInstance.(*livechat.LiveChat); ok {
		data["uuid"] = conversationUUID
		liveChatInbox.BroadcastConversationToClients(conversationUUID, contactID, data)
	}
}

func convToBroadcast(conv *cmodels.ConversationListItem) *broadcastConv {
	if conv == nil {
		return nil
	}
	return &broadcastConv{ConversationListItem: conv}
}

// wsTime formats a timestamp for WS payloads with sub-second precision, matching the REST API
// (time.Time marshals as RFC3339Nano), so clients can order two events within the same second.
func wsTime(t time.Time) string {
	return t.Format(time.RFC3339Nano)
}

// broadcastListItem pushes the conversation's full list item as `new_conversation` to every
// authorized connected agent. `conversation_update` only reaches clients subscribed to the
// conversation, so after a status change (reopen, resolve, snooze, close) an agent whose list
// has not loaded it could not insert it. A status change does not change who may see the
// conversation, so no previous state is needed.
func (m *Manager) broadcastListItem(uuid string) {
	item, err := m.GetConversationListItem(uuid)
	if err != nil {
		m.lo.Error("error fetching conversation list item for status broadcast", "uuid", uuid, "error", err)
		return
	}
	m.BroadcastNewConversation(&item)
}

// wsMetaFields: the message meta fields clients need with new_message: echo_id (the agent's own
// optimistic message) and omni_event (a note the omnichannel gateway wrote).
func wsMetaFields(raw json.RawMessage) map[string]string {
	out := map[string]string{}
	if len(raw) == 0 {
		return out
	}
	var meta map[string]any
	if json.Unmarshal(raw, &meta) != nil {
		return out
	}
	for _, k := range []string{"echo_id", "omni_event"} {
		if v, ok := meta[k].(string); ok && v != "" {
			out[k] = v
		}
	}
	return out
}
