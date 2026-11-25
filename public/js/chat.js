(() => {
  const $ = (id) => document.getElementById(id);
  let currentUser = null;
  let memberships = [];
  let conversations = [];
  let activeConversation = null;
  let refreshTimer = null;
  let initialized = false;
  let realtimeClient = null;
  let realtimeChannel = null;
  let realtimeConversationId = null;
  let realtimeAccessToken = null;
  let realtimeStatus = "DISCONNECTED";
  let realtimeRefreshQueued = false;

  async function api(path, options = {}) {
    const saved = sessionStorage.getItem("eamwifi_session");
    const session = saved ? JSON.parse(saved) : null;
    if (!session?.access_token) throw new Error("Please sign in again.");
    const headers = new Headers(options.headers || {});
    headers.set("authorization", "Bearer " + session.access_token);
    if (options.body && !(options.body instanceof FormData)) headers.set("content-type", "application/json");
    const response = await fetch(path, { ...options, headers });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.message || data.msg || data.error_description || data.error || "Request failed (" + response.status + ")");
    return data;
  }

  function selectedValues(select) {
    return Array.from(select.selectedOptions).map(option => option.value).filter(Boolean);
  }

  function setFeedback(id, message, isError = true) {
    const node = $(id);
    if (!node) return;
    node.textContent = message;
    node.style.color = isError ? "#a33b32" : "#26734d";
  }

  async function loadMembers() {
    const type = $("chat-type").value;
    const orgId = $("chat-organization").value;
    const recipientSelect = $("chat-recipients");
    recipientSelect.replaceChildren();
    if (type !== "broadcast" && !orgId) return;
    const members = await api("/api/chat/members" + (type === "broadcast" ? "" : "?organization_id=" + encodeURIComponent(orgId)));
    const unique = new Map();
    members.forEach(member => {
      if (member.user_id !== currentUser.id) unique.set(member.user_id, member);
    });
    unique.forEach(member => {
      const option = document.createElement("option");
      option.value = member.user_id;
      option.textContent = (member.role || "member") + " · " + member.user_id.slice(0, 8);
      recipientSelect.append(option);
    });
    if (!recipientSelect.options.length) {
      const option = document.createElement("option");
      option.disabled = true;
      option.textContent = "No other active members found";
      recipientSelect.append(option);
    }
  }

  async function loadConversations() {
    const host = $("chat-conversations");
    const list = await api("/api/chat/conversations");
    conversations = Array.isArray(list) ? list : [];
    host.replaceChildren();
    if (!conversations.length) {
      const empty = document.createElement("p");
      empty.className = "muted small";
      empty.textContent = "No conversations yet. Start a private chat or group.";
      host.append(empty);
      return;
    }
    conversations.forEach(conversation => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "chat-conversation" + (activeConversation?.id === conversation.id ? " active" : "");
      const title = document.createElement("strong");
      const typeLabel = conversation.conversation_type === "broadcast" ? "Broadcast" : conversation.conversation_type === "group" ? "Group chat" : "Private chat";
      title.textContent = conversation.title || typeLabel;
      const meta = document.createElement("small");
      meta.textContent = typeLabel + " · " + new Date(conversation.updated_at || conversation.created_at).toLocaleString();
      button.append(title, meta);
      button.addEventListener("click", () => openConversation(conversation));
      host.append(button);
    });
  }

  async function loadMessages() {
    if (!activeConversation) return;
    const host = $("chat-messages");
    const conversationId = activeConversation.id;
    const messages = await api("/api/chat/messages?conversation_id=" + encodeURIComponent(conversationId));
    if (activeConversation?.id !== conversationId) return;
    host.replaceChildren();
    if (!messages.length) {
      const empty = document.createElement("p");
      empty.className = "muted small";
      empty.textContent = "No messages yet. Say hello.";
      host.append(empty);
    }
    for (const message of messages) {
      const bubble = document.createElement("article");
      bubble.className = "chat-bubble" + (message.sender_id === currentUser.id ? " mine" : "");
      if (message.deleted_at) {
        const deleted = document.createElement("p");
        deleted.textContent = "This message was deleted.";
        bubble.append(deleted);
      } else if (message.message_type === "image" || message.message_type === "file") {
        if (message.body) {
          const caption = document.createElement("p");
          caption.textContent = message.body;
          bubble.append(caption);
        }
        try {
          const attachment = await api("/api/chat/attachment?path=" + encodeURIComponent(message.media_path));
          if (message.message_type === "image") {
            const preview = document.createElement("img");
            preview.src = attachment.url;
            preview.alt = message.attachment_name || "Chat image";
            preview.loading = "lazy";
            preview.className = "chat-attachment-image";
            bubble.append(preview);
          }
          const link = document.createElement("a");
          link.href = attachment.url;
          link.target = "_blank";
          link.rel = "noopener noreferrer";
          link.textContent = "📎 " + (message.attachment_name || "Open attachment");
          link.className = "chat-attachment-link";
          bubble.append(link);
          const size = document.createElement("small");
          size.textContent = Math.max(1, Math.round((message.attachment_size_bytes || 0) / 1024)) + " KB";
          bubble.append(size);
        } catch {
          const unavailable = document.createElement("p");
          unavailable.className = "muted small";
          unavailable.textContent = "Attachment unavailable or your access has expired.";
          bubble.append(unavailable);
        }
      } else {
        const body = document.createElement("p");
        body.textContent = message.body || "";
        bubble.append(body);
      }
      const meta = document.createElement("small");
      meta.textContent = (message.sender_id === currentUser.id ? "You" : "Participant " + message.sender_id.slice(0, 8)) + " · " + new Date(message.created_at).toLocaleString();
      bubble.append(meta);
      host.append(bubble);
    }
    host.scrollTop = host.scrollHeight;
    await api("/api/chat/read", { method: "POST", body: JSON.stringify({ conversation_id: conversationId }) });
  }

  async function openConversation(conversation) {
    activeConversation = conversation;
    const typeLabel = conversation.conversation_type === "broadcast" ? "Super Admin broadcast" : conversation.conversation_type === "group" ? "Group conversation" : "Private conversation";
    $("chat-thread-head").replaceChildren();
    const title = document.createElement("strong");
    title.textContent = conversation.title || typeLabel;
    const sub = document.createElement("small");
    sub.textContent = typeLabel + " · Messages are protected by participant-level access rules.";
    $("chat-thread-head").append(title, sub);
    $("chat-message-input").disabled = false;
    $("chat-attachment-input").disabled = false;
    $("chat-send").disabled = false;
    await loadConversations();
    await loadMessages();
    await connectRealtime(conversation.id);
  }

  async function connectRealtime(conversationId) {
    if (!conversationId || !currentUser) return;
    const saved = sessionStorage.getItem("eamwifi_session");
    const session = saved ? JSON.parse(saved) : null;
    if (!session?.access_token) return;
    if (realtimeConversationId === conversationId && realtimeAccessToken === session.access_token && realtimeChannel && realtimeStatus === "SUBSCRIBED") return;
    if (realtimeClient && realtimeChannel) {
      try { await realtimeClient.removeChannel(realtimeChannel); } catch { /* reconnect below */ }
    }
    realtimeClient = null;
    realtimeChannel = null;
    realtimeConversationId = conversationId;
    realtimeAccessToken = session.access_token;
    realtimeStatus = "CONNECTING";
    try {
      const { createClient } = await import("https://cdn.jsdelivr.net/npm/supabase/supabase-js@2.119.2/+esm");
      const client = createClient("https://jvzjzmfnxytryzpylrqj.supabase.co", "sb_publishable_Ajn7XOxAkv00DmrXOG-YDA__-b2FVt8", {
        auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
        realtime: { params: { eventsPerSecond: 10 } }
      });
      await client.realtime.setAuth(session.access_token);
      realtimeClient = client;
      realtimeChannel = client.channel("eam-chat-" + conversationId)
        .on("postgres_changes", { event: "*", schema: "public", table: "chat_messages", filter: "conversation_id=eq." + conversationId }, () => {
          if (realtimeRefreshQueued) return;
          realtimeRefreshQueued = true;
          Promise.resolve().then(async () => {
            realtimeRefreshQueued = false;
            if (!document.hidden && activeConversation?.id === conversationId) {
              try { await loadMessages(); await loadConversations(); } catch (error) { setFeedback("chat-feedback", error.message); }
            }
          });
        })
        .on("postgres_changes", { event: "*", schema: "public", table: "chat_participants", filter: "user_id=eq." + currentUser.id }, async () => {
          try { await loadConversations(); } catch { /* transient refresh failure */ }
        })
        .on("postgres_changes", { event: "*", schema: "public", table: "chat_conversations" }, async () => {
          try { await loadConversations(); } catch { /* RLS limits rows to conversations this user may see */ }
        })
        .subscribe(status => {
          realtimeStatus = status;
          if (status === "SUBSCRIBED") {
            setFeedback("chat-feedback", "Live connection active · Ujumbe unaingia moja kwa moja.", false);
            if (!document.hidden && activeConversation?.id === conversationId) {
              loadMessages().then(loadConversations).catch(error => setFeedback("chat-feedback", error.message));
            }
          } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
            setFeedback("chat-feedback", "Live connection interrupted. Automatic refresh is active.", true);
          }
        });
    } catch (error) {
      realtimeStatus = "CHANNEL_ERROR";
      setFeedback("chat-feedback", "Live connection unavailable; automatic refresh will continue. " + (error.message || ""), true);
    }
  }

  async function createConversation() {
    const type = $("chat-type").value;
    const orgId = $("chat-organization").value;
    const userIds = selectedValues($("chat-recipients"));
    if (type !== "broadcast" && !orgId) throw new Error("Choose a business first.");
    if (type === "direct" && userIds.length !== 1) throw new Error("Choose exactly one person for a private chat.");
    if ((type === "group" || type === "broadcast") && userIds.length < 1) throw new Error("Choose at least one participant.");
    const result = await api("/api/chat/conversations", {
      method: "POST",
      body: JSON.stringify({
        conversation_type: type,
        organization_id: type === "broadcast" ? null : orgId,
        title: $("chat-title").value.trim(),
        user_ids: userIds
      })
    });
    $("chat-title").value = "";
    setFeedback("chat-create-feedback", "Conversation created.", false);
    await loadConversations();
    await openConversation(result);
  }

  function initializeControls(isAdmin) {
    if (initialized) return;
    initialized = true;
    $("chat-broadcast-option").disabled = !isAdmin;
    $("chat-type").addEventListener("change", async () => {
      const broadcast = $("chat-type").value === "broadcast";
      $("chat-org-wrap").hidden = broadcast;
      $("chat-organization").disabled = broadcast;
      $("chat-recipients").multiple = $("chat-type").value !== "direct";
      try { await loadMembers(); } catch (error) { setFeedback("chat-create-feedback", error.message); }
    });
    $("chat-organization").addEventListener("change", async () => {
      try { await loadMembers(); } catch (error) { setFeedback("chat-create-feedback", error.message); }
    });
    $("chat-create").addEventListener("click", async () => {
      const button = $("chat-create");
      button.disabled = true;
      setFeedback("chat-create-feedback", "Creating conversation…", false);
      try { await createConversation(); }
      catch (error) { setFeedback("chat-create-feedback", error.message); }
      finally { button.disabled = false; }
    });
    $("chat-send-form").addEventListener("submit", async event => {
      event.preventDefault();
      const input = $("chat-message-input");
      const fileInput = $("chat-attachment-input");
      const button = $("chat-send");
      const body = input.value.trim();
      const file = fileInput.files?.[0];
      if (!activeConversation || (!body && !file)) return;
      button.disabled = true;
      try {
        if (file) {
          if (file.size > 15 * 1024 * 1024) throw new Error("Attachment must not exceed 15 MB.");
          const form = new FormData();
          form.append("conversation_id", activeConversation.id);
          form.append("body", body);
          form.append("file", file);
          setFeedback("chat-feedback", "Uploading attachment…", false);
          await api("/api/chat/attachments", { method: "POST", body: form });
          fileInput.value = "";
        } else {
          await api("/api/chat/messages", { method: "POST", body: JSON.stringify({ conversation_id: activeConversation.id, body }) });
        }
        input.value = "";
        await loadMessages();
        await loadConversations();
      } catch (error) { setFeedback("chat-feedback", error.message); }
      finally { button.disabled = false; }
    });
    $("chat-refresh").addEventListener("click", async () => {
      try { await loadConversations(); if (activeConversation) await loadMessages(); }
      catch (error) { setFeedback("chat-feedback", error.message); }
    });
  }

  async function start(user, userMemberships) {
    if (currentUser && user && currentUser.id !== user.id) await stopRealtime();
    currentUser = user;
    memberships = Array.isArray(userMemberships) ? userMemberships : [];
    const isAdmin = (user.email || "").toLowerCase() === "mwalimueckson2104@gmail.com";
    $("chat-panel").classList.toggle("hidden", !isAdmin && !memberships.some(m => m.status === "active"));
    if ($("chat-panel").classList.contains("hidden")) return;
    initializeControls(isAdmin);
    const orgSelect = $("chat-organization");
    const previous = orgSelect.value;
    orgSelect.replaceChildren();
    memberships.filter(m => m.status === "active" && m.organization).forEach(m => {
      const option = document.createElement("option");
      option.value = m.organization_id;
      option.textContent = m.organization.name;
      orgSelect.append(option);
    });
    if (previous && Array.from(orgSelect.options).some(o => o.value === previous)) orgSelect.value = previous;
    if (isAdmin) $("chat-broadcast-option").disabled = false;
    try {
      await loadMembers();
      await loadConversations();
      if (activeConversation && conversations.some(c => c.id === activeConversation.id)) {
        activeConversation = conversations.find(c => c.id === activeConversation.id);
        await loadMessages();
        await connectRealtime(activeConversation.id);
      } else {
        activeConversation = null;
        $("chat-thread-head").innerHTML = "<strong>Select a conversation</strong>";
        $("chat-messages").textContent = "Your messages will appear here.";
        $("chat-message-input").disabled = true;
        $("chat-attachment-input").disabled = true;
        $("chat-send").disabled = true;
      }
    } catch (error) {
      setFeedback("chat-feedback", error.message);
    }
    if (refreshTimer) clearInterval(refreshTimer);
    refreshTimer = setInterval(async () => {
      if (!document.hidden && currentUser && realtimeStatus !== "SUBSCRIBED") {
        try { await loadConversations(); if (activeConversation) await loadMessages(); } catch { /* transient network issue */ }
      }
    }, 45000);
  }

  async function stopRealtime() {
    if (realtimeClient && realtimeChannel) {
      try { await realtimeClient.removeChannel(realtimeChannel); } catch { /* already disconnected */ }
    }
    realtimeClient = null;
    realtimeChannel = null;
    realtimeConversationId = null;
    realtimeAccessToken = null;
    realtimeStatus = "DISCONNECTED";
    if (refreshTimer) clearInterval(refreshTimer);
    refreshTimer = null;
  }

  window.EAMChat = { start, stop: stopRealtime };
})();