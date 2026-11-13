const SUPABASE_URL = "https://sfidyscinqmzxigufukx.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_UNH4Od9YVVlu7D12Dtivog_w-5V9mmg";

if (!window.supabaseClient) {
  window.supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
}
var supabase = window.supabaseClient;

const $ = (id) => document.getElementById(id);
const authScreen = $("authScreen");
const chatScreen = $("chatScreen");

let currentUser = null;
let currentAccessToken = null;
let myProfile = null;
let activeUser = null;
let activeRoom = null;
let profiles = [];
let onlineUsersMap = new Map();
let friendRequests = [];
let messageCache = {};
let roomMessageCache = {};

// Stories State
let activeStories = [];
let groupedStoriesByUser = [];
let viewerGroupIndex = 0;
let viewerStoryIndex = 0;
let selectedStoryBg = "linear-gradient(135deg, #7558f5, #ff77ad)";
let viewedStoryIds = new Set(JSON.parse(localStorage.getItem("waibhav_viewed_stories") || "[]"));

// Rooms State
let allRooms = [];
let myJoinedRoomIds = new Set();

// Realtime Channels
let presenceChannel = null;
let messageChannel = null;
let typingChannel = null;
let requestChannel = null;
let globalMessageNotifierChannel = null;
let callChannel = null;
let socialRealtimeChannel = null;
let isInitializingChat = false;

// WebRTC Call State
let peerConnection = null;
let localStream = null;
let remoteStream = null;
let incomingOfferPayload = null;
let activeCallPeerId = null;
let isVideoCall = false;
let isMicMuted = false;
let isCameraOff = false;
let callTimerInterval = null;
let callSeconds = 0;
let pendingIceCandidates = [];

const ICE_SERVERS = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" }
  ]
};

// Auth & Navigation State
let authMode = "guest";
let captchaAnswer = 7;
let activeSidebarTab = "chats"; // 'chats' | 'rooms' | 'requests' | 'all'
let unreadCounts = {};
let typingTimeout = null;
let searchQuery = "";

function toast(message) {
  const el = $("toast");
  if (!el) return;
  el.textContent = message;
  el.classList.add("show");
  setTimeout(() => el.classList.remove("show"), 3200);
}

function avatarUrl(url, name = "User") {
  return url || `https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&background=eee9ff&color=7659e8`;
}

function showAuthMessage(message = "") {
  const msgEl = $("authMessage");
  if (msgEl) msgEl.textContent = message;
}

async function isDisplayNameTaken(name) {
  const { data, error } = await supabase
    .from("profiles")
    .select("id")
    .ilike("display_name", name.trim())
    .limit(1);

  if (error) return false;
  return data && data.length > 0;
}

function generateCaptcha() {
  const a = Math.floor(Math.random() * 9) + 1;
  const b = Math.floor(Math.random() * 9) + 1;
  captchaAnswer = a + b;
  $("captchaQuestion").textContent = `${a} + ${b} = ?`;
  $("captchaInput").value = "";
}

$("refreshCaptcha").addEventListener("click", generateCaptcha);
generateCaptcha();

$("showGuest").addEventListener("click", () => setAuthMode("guest"));
$("showLogin").addEventListener("click", () => setAuthMode("login"));
$("showSignup").addEventListener("click", () => setAuthMode("signup"));

function setAuthMode(mode) {
  authMode = mode;
  $("showGuest").classList.toggle("active", mode === "guest");
  $("showLogin").classList.toggle("active", mode === "login");
  $("showSignup").classList.toggle("active", mode === "signup");

  const showName = mode === "guest" || mode === "signup";
  const showEmailPass = mode === "login" || mode === "signup";
  const showCaptcha = mode === "guest";

  $("displayName").classList.toggle("hidden", !showName);
  $("nameLabel").classList.toggle("hidden", !showName);
  $("displayName").required = showName;

  $("emailPasswordGroup").classList.toggle("hidden", !showEmailPass);
  $("email").required = showEmailPass;
  $("password").required = showEmailPass;

  $("captchaGroup").classList.toggle("hidden", !showCaptcha);
  $("captchaInput").required = showCaptcha;

  if (mode === "guest") {
    $("authSubmit").textContent = "Join as Guest";
    generateCaptcha();
  } else if (mode === "login") {
    $("authSubmit").textContent = "Log in";
    $("password").autocomplete = "current-password";
  } else {
    $("authSubmit").textContent = "Create account";
    $("password").autocomplete = "new-password";
  }
  showAuthMessage("");
}

$("authForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const displayName = $("displayName").value.trim();
  const email = $("email").value.trim();
  const password = $("password").value;

  if ((authMode === "guest" || authMode === "signup") && !displayName) {
    showAuthMessage("Please enter your name.");
    return;
  }

  if (authMode === "guest") {
    const userAns = parseInt($("captchaInput").value, 10);
    if (userAns !== captchaAnswer) {
      showAuthMessage("Incorrect Captcha answer. Please try again.");
      generateCaptcha();
      return;
    }
  }

  $("authSubmit").disabled = true;
  showAuthMessage("Checking availability...");

  try {
    if (authMode === "guest" || authMode === "signup") {
      const taken = await isDisplayNameTaken(displayName);
      if (taken) {
        showAuthMessage("⚠️ Username already exists. Kindly enter a different name.");
        $("authSubmit").disabled = false;
        return;
      }
    }

    showAuthMessage("Please wait...");

    if (authMode === "guest") {
      const { data, error } = await supabase.auth.signInAnonymously({
        options: { data: { display_name: displayName } }
      });
      if (error) throw error;

      if (data?.user) {
        await supabase.from("profiles").upsert({
          id: data.user.id,
          display_name: displayName,
          is_online: true,
          last_seen: new Date().toISOString()
        });
      }
      showAuthMessage("Joining chat...");
    } else if (authMode === "signup") {
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: { data: { display_name: displayName } }
      });
      if (error) throw error;

      if (data?.user) {
        await supabase.from("profiles").upsert({
          id: data.user.id,
          display_name: displayName,
          is_online: true,
          last_seen: new Date().toISOString()
        });
      }

      if (data?.user && !data?.session) {
        showAuthMessage("Account created! Check your email to confirm, then log in.");
      } else {
        showAuthMessage("Account created! Opening chat...");
      }
    } else {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
    }
  } catch (error) {
    console.error("Auth error:", error);
    showAuthMessage(error.message || "Authentication failed.");
    if (authMode === "guest") generateCaptcha();
  } finally {
    $("authSubmit").disabled = false;
  }
});

// ==========================================
// 4-TAB SIDEBAR NAVIGATION
// ==========================================

$("tabChats").addEventListener("click", () => switchSidebarTab("chats"));
$("tabRooms").addEventListener("click", () => switchSidebarTab("rooms"));
$("tabRequests").addEventListener("click", () => switchSidebarTab("requests"));
$("tabAllUsers").addEventListener("click", () => switchSidebarTab("all"));

function switchSidebarTab(tab) {
  activeSidebarTab = tab;
  $("tabChats").classList.toggle("active", tab === "chats");
  $("tabRooms").classList.toggle("active", tab === "rooms");
  $("tabRequests").classList.toggle("active", tab === "requests");
  $("tabAllUsers").classList.toggle("active", tab === "all");

  $("searchContainer").classList.toggle("hidden", tab === "requests");
  $("openCreateRoomBtn").classList.toggle("hidden", tab !== "rooms");

  $("chatUserList").classList.toggle("hidden", tab !== "chats");
  $("roomsList").classList.toggle("hidden", tab !== "rooms");
  $("requestList").classList.toggle("hidden", tab !== "requests");
  $("allUsersList").classList.toggle("hidden", tab !== "all");

  $("userSearchInput").placeholder = tab === "rooms" ? "Search hangout rooms..." : "Search people by name...";
  renderAllLists();
}

// ==========================================
// INSTANT ONLINE & LAST SEEN PRESENCE ENGINE
// ==========================================

function isUserOnline(profile) {
  if (!profile) return false;
  if (onlineUsersMap.has(String(profile.id))) return true;
  if (profile.is_online === true && profile.last_seen) {
    const diffMs = Date.now() - new Date(profile.last_seen).getTime();
    if (!isNaN(diffMs) && diffMs >= -10000 && diffMs < 35000) return true;
  }
  return false;
}

function formatLastSeen(isoDateStr) {
  if (!isoDateStr) return "Offline";
  const date = new Date(isoDateStr);
  if (isNaN(date.getTime())) return "Offline";

  const now = new Date();
  const diffMins = Math.floor((now - date) / 60000);

  if (diffMins < 1) return "Just now";
  if (diffMins < 60) return `${diffMins}m ago`;

  if (date.toDateString() === now.toDateString()) {
    return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }
  return date.toLocaleDateString([], { month: "short", day: "numeric" });
}

async function setOnlineStatusInDB(isOnline) {
  if (!currentUser) return;
  await supabase
    .from("profiles")
    .update({
      is_online: isOnline,
      last_seen: new Date().toISOString()
    })
    .eq("id", currentUser.id);
}

function handleGoOfflineImmediately() {
  if (!currentUser) return;
  if (presenceChannel) {
    presenceChannel.untrack();
  }
  fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${currentUser.id}`, {
    method: "PATCH",
    keepalive: true,
    headers: {
      "Content-Type": "application/json",
      "apikey": SUPABASE_ANON_KEY,
      "Authorization": `Bearer ${currentAccessToken || SUPABASE_ANON_KEY}`,
      "Prefer": "return=minimal"
    },
    body: JSON.stringify({
      is_online: false,
      last_seen: new Date().toISOString()
    })
  }).catch(() => {});
}

document.addEventListener("visibilitychange", () => {
  if (!currentUser) return;
  if (document.visibilityState === "hidden") {
    handleGoOfflineImmediately();
  } else if (document.visibilityState === "visible") {
    setOnlineStatusInDB(true);
    if (presenceChannel) {
      presenceChannel.track({
        user_id: String(currentUser.id),
        online_at: new Date().toISOString()
      });
    }
  }
});

window.addEventListener("pagehide", handleGoOfflineImmediately);
window.addEventListener("beforeunload", handleGoOfflineImmediately);

setInterval(() => {
  if (currentUser && document.visibilityState === "visible") {
    setOnlineStatusInDB(true);
  }
}, 20 * 1000);

setInterval(() => {
  if (currentUser) {
    renderAcceptedChats();
    if (activeUser) updateActiveStatus();
  }
}, 10 * 1000);

async function loadMyProfile() {
  const { data } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", currentUser.id)
    .maybeSingle();

  const fallbackName = currentUser.user_metadata?.display_name || currentUser.email || "Guest";
  myProfile = data || { display_name: fallbackName, avatar_url: null };

  if (!data) {
    await supabase.from("profiles").upsert({
      id: currentUser.id,
      display_name: fallbackName,
      is_online: true,
      last_seen: new Date().toISOString()
    });
  }

  $("myName").textContent = myProfile.display_name || fallbackName;
  $("myAvatar").src = avatarUrl(myProfile.avatar_url, myProfile.display_name);
}

// ==========================================
// 24-HOUR STORIES ENGINE
// ==========================================

async function loadStories() {
  const { data, error } = await supabase
    .from("stories")
    .select("*")
    .gt("expires_at", new Date().toISOString())
    .order("created_at", { ascending: true });

  if (error) return;

  const acceptedFriendIds = new Set(
    friendRequests
      .filter(r => r.status === "accepted")
      .map(r => (String(r.sender_id) === String(currentUser.id) ? String(r.receiver_id) : String(r.sender_id)))
  );
  acceptedFriendIds.add(String(currentUser.id));

  activeStories = (data || []).filter(s => acceptedFriendIds.has(String(s.user_id)));

  const map = new Map();
  activeStories.forEach(story => {
    const uid = String(story.user_id);
    if (!map.has(uid)) {
      const userObj = uid === String(currentUser.id)
        ? { id: currentUser.id, display_name: "You", avatar_url: myProfile?.avatar_url }
        : profiles.find(p => String(p.id) === uid) || { id: uid, display_name: "Friend", avatar_url: null };
      map.set(uid, { user: userObj, stories: [] });
    }
    map.get(uid).stories.push(story);
  });

  groupedStoriesByUser = Array.from(map.values()).sort((a, b) =>
    String(a.user.id) === String(currentUser.id) ? -1 : String(b.user.id) === String(currentUser.id) ? 1 : 0
  );

  renderStoriesStrip();
}

function renderStoriesStrip() {
  const strip = $("storiesStrip");
  const addBtn = $("addStoryBtn");
  strip.replaceChildren(addBtn);

  groupedStoriesByUser.forEach((group, groupIdx) => {
    const allViewed = group.stories.every(s => viewedStoryIds.has(s.id));

    const btn = document.createElement("button");
    btn.className = "story-item";
    btn.type = "button";
    btn.onclick = () => openStoryViewer(groupIdx, 0);

    const ring = document.createElement("div");
    ring.className = "story-ring" + (allViewed ? " viewed" : "");

    const img = document.createElement("img");
    img.src = avatarUrl(group.user.avatar_url, group.user.display_name);
    img.alt = group.user.display_name;
    ring.append(img);

    const label = document.createElement("span");
    label.className = "story-name";
    label.textContent = String(group.user.id) === String(currentUser.id) ? "My Story" : group.user.display_name;

    btn.append(ring, label);
    strip.append(btn);
  });
}

$("addStoryBtn").addEventListener("click", () => {
  $("storyText").value = "";
  $("storyImageInput").value = "";
  $("createStoryModal").classList.remove("hidden");
});

$("closeCreateStory").addEventListener("click", () => {
  $("createStoryModal").classList.add("hidden");
});

document.querySelectorAll(".color-swatch").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".color-swatch").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    selectedStoryBg = btn.dataset.bg;
  });
});

$("storyForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const content = $("storyText").value.trim();
  const file = $("storyImageInput").files[0];

  if (!content && !file) {
    toast("Add text or pick a photo for your story.");
    return;
  }

  $("publishStoryBtn").disabled = true;
  $("publishStoryBtn").textContent = "Posting...";

  try {
    let imageUrl = null;
    if (file) {
      if (!file.type.startsWith("image/")) throw new Error("Please select an image file.");
      if (file.size > 5 * 1024 * 1024) throw new Error("Image must be under 5 MB.");

      const ext = file.name.split(".").pop().toLowerCase().replace(/[^a-z0-9]/g, "") || "jpg";
      const filePath = `stories/${currentUser.id}/${Date.now()}.${ext}`;

      const { error: upErr } = await supabase.storage
        .from("chat-photos")
        .upload(filePath, file, { upsert: true, contentType: file.type });

      if (upErr) throw upErr;
      const { data: pub } = supabase.storage.from("chat-photos").getPublicUrl(filePath);
      imageUrl = pub.publicUrl;
    }

    const { error } = await supabase.from("stories").insert({
      user_id: currentUser.id,
      content: content || null,
      image_url: imageUrl,
      bg_color: selectedStoryBg
    });

    if (error) throw error;

    toast("Story posted for 24 hours!");
    $("createStoryModal").classList.add("hidden");
    await loadStories();
  } catch (err) {
    toast(err.message || "Failed to post story.");
  } finally {
    $("publishStoryBtn").disabled = false;
    $("publishStoryBtn").textContent = "Share Story ✨";
  }
});

function openStoryViewer(groupIdx, storyIdx) {
  if (!groupedStoriesByUser[groupIdx]) return;
  viewerGroupIndex = groupIdx;
  viewerStoryIndex = storyIdx;
  $("storyViewerModal").classList.remove("hidden");
  renderCurrentStorySlide();
}

function renderCurrentStorySlide() {
  const group = groupedStoriesByUser[viewerGroupIndex];
  if (!group || !group.stories[viewerStoryIndex]) {
    $("storyViewerModal").classList.add("hidden");
    return;
  }

  const story = group.stories[viewerStoryIndex];

  viewedStoryIds.add(story.id);
  localStorage.setItem("waibhav_viewed_stories", JSON.stringify(Array.from(viewedStoryIds)));
  renderStoriesStrip();

  const bars = $("storyProgressBars");
  bars.replaceChildren();
  group.stories.forEach((_, idx) => {
    const seg = document.createElement("div");
    seg.className = "story-progress-seg" + (idx <= viewerStoryIndex ? " active" : "");
    bars.append(seg);
  });

  $("storyViewerCard").style.background = story.bg_color || "linear-gradient(135deg, #7558f5, #ff77ad)";
  $("viewerUserAvatar").src = avatarUrl(group.user.avatar_url, group.user.display_name);
  $("viewerUserName").textContent = String(group.user.id) === String(currentUser.id) ? "Your Story" : group.user.display_name;
  $("viewerTime").textContent = formatLastSeen(story.created_at);

  $("deleteStoryBtn").classList.toggle("hidden", String(story.user_id) !== String(currentUser.id));

  if (story.image_url) {
    $("viewerImage").src = story.image_url;
    $("viewerImage").classList.remove("hidden");
  } else {
    $("viewerImage").classList.add("hidden");
  }

  $("viewerCaption").textContent = story.content || "";
}

$("nextStoryBtn").addEventListener("click", () => {
  const group = groupedStoriesByUser[viewerGroupIndex];
  if (viewerStoryIndex + 1 < group.stories.length) {
    viewerStoryIndex++;
    renderCurrentStorySlide();
  } else if (viewerGroupIndex + 1 < groupedStoriesByUser.length) {
    viewerGroupIndex++;
    viewerStoryIndex = 0;
    renderCurrentStorySlide();
  } else {
    $("storyViewerModal").classList.add("hidden");
  }
});

$("prevStoryBtn").addEventListener("click", () => {
  if (viewerStoryIndex > 0) {
    viewerStoryIndex--;
    renderCurrentStorySlide();
  } else if (viewerGroupIndex > 0) {
    viewerGroupIndex--;
    viewerStoryIndex = groupedStoriesByUser[viewerGroupIndex].stories.length - 1;
    renderCurrentStorySlide();
  }
});

$("closeStoryViewer").addEventListener("click", () => {
  $("storyViewerModal").classList.add("hidden");
});

$("deleteStoryBtn").addEventListener("click", async () => {
  const group = groupedStoriesByUser[viewerGroupIndex];
  const story = group?.stories[viewerStoryIndex];
  if (!story || !confirm("Delete this story?")) return;

  const { error } = await supabase.from("stories").delete().eq("id", story.id);
  if (error) {
    toast("Failed to delete story.");
  } else {
    toast("Story deleted.");
    $("storyViewerModal").classList.add("hidden");
    await loadStories();
  }
});

// ==========================================
// GROUP CHATS / PUBLIC HANGOUT ROOMS ENGINE
// ==========================================

async function loadRooms() {
  const { data: roomsData, error: roomsErr } = await supabase
    .from("rooms")
    .select("*")
    .order("created_at", { ascending: false });

  if (roomsErr) return;

  const { data: memberData } = await supabase
    .from("room_members")
    .select("room_id")
    .eq("user_id", currentUser.id);

  myJoinedRoomIds = new Set((memberData || []).map(m => m.room_id));
  allRooms = roomsData || [];
  renderRoomsList();
}

function renderRoomsList() {
  const filteredRooms = allRooms.filter(r =>
    r.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    (r.description || "").toLowerCase().includes(searchQuery.toLowerCase())
  );

  const list = $("roomsList");
  list.replaceChildren();

  if (!filteredRooms.length) {
    const p = document.createElement("p");
    p.className = "empty-hint";
    p.textContent = searchQuery ? "No rooms match your search." : "No hangout rooms yet. Click + to create one!";
    list.append(p);
    return;
  }

  filteredRooms.forEach(room => {
    const isJoined = myJoinedRoomIds.has(room.id);
    const item = document.createElement("div");
    item.className = "user-item" + (activeRoom?.id === room.id ? " selected" : "");
    item.addEventListener("click", () => openRoomConversation(room));

    const icon = document.createElement("div");
    icon.className = "room-avatar-badge";
    icon.textContent = "#";

    const info = document.createElement("div");
    info.className = "user-info";
    const title = document.createElement("strong");
    title.textContent = room.name;
    const desc = document.createElement("span");
    desc.textContent = room.description || (isJoined ? "Joined room" : "Public hangout room");
    info.append(title, desc);

    const btn = document.createElement("button");
    btn.className = "user-action-chip " + (isJoined ? "chip-chat" : "chip-add");
    btn.textContent = isJoined ? "Open" : "+ Join";
    btn.onclick = async (e) => {
      e.stopPropagation();
      if (!isJoined) {
        await joinRoom(room);
      } else {
        openRoomConversation(room);
      }
    };

    item.append(icon, info, btn);
    list.append(item);
  });
}

$("openCreateRoomBtn").addEventListener("click", () => {
  $("roomNameInput").value = "";
  $("roomDescInput").value = "";
  $("createRoomModal").classList.remove("hidden");
});

$("closeCreateRoom").addEventListener("click", () => {
  $("createRoomModal").classList.add("hidden");
});

$("createRoomForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const name = $("roomNameInput").value.trim();
  const description = $("roomDescInput").value.trim();
  if (!name) return;

  $("submitCreateRoomBtn").disabled = true;
  try {
    const { data: newRoom, error } = await supabase
      .from("rooms")
      .insert({ name, description: description || null, is_public: true, created_by: currentUser.id })
      .select()
      .single();

    if (error) throw error;

    await supabase.from("room_members").insert({
      room_id: newRoom.id,
      user_id: currentUser.id
    });

    toast(`Created room "${name}"!`);
    $("createRoomModal").classList.add("hidden");
    await loadRooms();
    openRoomConversation(newRoom);
  } catch (err) {
    toast(err.message || "Failed to create room.");
  } finally {
    $("submitCreateRoomBtn").disabled = false;
  }
});

async function joinRoom(room) {
  const { error } = await supabase.from("room_members").insert({
    room_id: room.id,
    user_id: currentUser.id
  });

  if (error) {
    toast("Could not join room.");
    return;
  }

  toast(`Joined #${room.name}!`);
  myJoinedRoomIds.add(room.id);
  renderRoomsList();
  openRoomConversation(room);
}

$("leaveRoomBtn").addEventListener("click", async () => {
  if (!activeRoom) return;
  if (!confirm(`Leave #${activeRoom.name}?`)) return;

  const { error } = await supabase
    .from("room_members")
    .delete()
    .eq("room_id", activeRoom.id)
    .eq("user_id", currentUser.id);

  if (error) {
    toast("Failed to leave room.");
    return;
  }

  toast(`Left #${activeRoom.name}`);
  myJoinedRoomIds.delete(activeRoom.id);
  activeRoom = null;
  chatScreen.classList.remove("mobile-chat-active");
  $("conversationPanel").classList.add("hidden");
  $("welcomePanel").classList.remove("hidden");
  renderRoomsList();
});

async function openRoomConversation(room) {
  activeUser = null;
  activeRoom = room;
  showTypingIndicator(false);

  chatScreen.classList.add("mobile-chat-active");
  $("welcomePanel").classList.add("hidden");
  $("conversationPanel").classList.remove("hidden");
  $("activeName").textContent = `# ${room.name}`;
  $("activeAvatar").src = avatarUrl(null, room.name);
  $("activeStatus").textContent = room.description || "Public Hangout Room";
  $("activeStatus").style.color = "#7558f5";

  $("callHeaderActions").classList.add("hidden");
  const isJoined = myJoinedRoomIds.has(room.id);
  $("roomHeaderActions").classList.toggle("hidden", !isJoined);

  renderRoomsList();
  const box = $("messages");

  if (!isJoined) {
    box.innerHTML = `
      <div style="display:flex; flex-direction:column; align-items:center; justify-content:center; height:100%; text-align:center; padding:20px; gap:12px;">
        <p style="color:#666; font-size:14px; margin:0;">Join <strong>#${room.name}</strong> to read and send group messages.</p>
        <button class="primary-btn" style="width:auto; padding:12px 24px; margin-top:0;" id="joinRoomCenterBtn">Join Room 🚀</button>
      </div>
    `;
    $("joinRoomCenterBtn").onclick = () => joinRoom(room);
    $("messageForm").classList.add("hidden");
    return;
  }

  $("messageForm").classList.remove("hidden");

  if (roomMessageCache[room.id]) {
    renderRoomMessages(roomMessageCache[room.id]);
  } else {
    box.replaceChildren();
    const loading = document.createElement("p");
    loading.className = "empty-hint";
    loading.textContent = "Loading room messages...";
    box.append(loading);
  }

  await loadRoomMessages();

  if (messageChannel) await supabase.removeChannel(messageChannel);

  messageChannel = supabase.channel(`room-chat-${room.id}-${Date.now()}`)
    .on("postgres_changes", { event: "*", schema: "public", table: "room_messages", filter: `room_id=eq.${room.id}` }, async () => {
      await loadRoomMessages();
    })
    .subscribe();
}

async function loadRoomMessages() {
  if (!activeRoom) return;
  const targetRoomId = activeRoom.id;

  const { data, error } = await supabase
    .from("room_messages")
    .select("*")
    .eq("room_id", targetRoomId)
    .order("created_at", { ascending: true })
    .limit(60);

  if (activeRoom?.id !== targetRoomId) return;
  if (error) { toast(error.message); return; }

  roomMessageCache[targetRoomId] = data || [];
  renderRoomMessages(data || []);
}

function renderRoomMessages(messagesData) {
  const box = $("messages");
  box.replaceChildren();

  if (!messagesData.length) {
    const p = document.createElement("p");
    p.className = "empty-hint";
    p.textContent = "No messages in this room yet. Start the hangout! 🎉";
    box.append(p);
  } else {
    messagesData.forEach(message => {
      const isMine = String(message.sender_id) === String(currentUser.id);
      const bubble = document.createElement("div");
      bubble.className = "message " + (isMine ? "mine" : "theirs");

      if (!isMine) {
        const sender = profiles.find(p => String(p.id) === String(message.sender_id));
        const senderTag = document.createElement("span");
        senderTag.className = "room-sender-label";
        senderTag.textContent = sender?.display_name || "Member";
        bubble.append(senderTag);
      }

      const body = document.createElement("div");
      if (message.body.startsWith("[IMAGE]:")) {
        const imgUrl = message.body.replace("[IMAGE]:", "");
        const img = document.createElement("img");
        img.src = imgUrl;
        img.className = "chat-photo-attachment";
        img.loading = "lazy";
        img.onclick = () => window.open(imgUrl, "_blank");
        body.append(img);
      } else {
        body.textContent = message.body;
      }

      const footer = document.createElement("div");
      footer.className = "message-footer";
      const time = document.createElement("time");
      time.textContent = new Date(message.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
      footer.append(time);

      if (isMine) {
        const delBtn = document.createElement("button");
        delBtn.className = "delete-msg-btn";
        delBtn.title = "Delete message";
        delBtn.innerHTML = "🗑";
        delBtn.onclick = async (e) => {
          e.stopPropagation();
          if (!confirm("Delete this room message?")) return;
          await supabase.from("room_messages").delete().eq("id", message.id);
          await loadRoomMessages();
        };
        footer.append(delBtn);
      }

      bubble.append(body, footer);
      box.append(bubble);
    });
  }
  box.scrollTop = box.scrollHeight;
}

// ==========================================
// STRICT 3-TAB SEPARATION: CHATS / REQUESTS / USERS
// ==========================================

async function loadFriendRequests() {
  if (!currentUser) return;
  const { data, error } = await supabase
    .from("friend_requests")
    .select("*")
    .or(`sender_id.eq.${currentUser.id},receiver_id.eq.${currentUser.id}`);

  if (!error) {
    friendRequests = data || [];
    updateRequestBadge();
    renderAllLists();
  }
}

function updateRequestBadge() {
  const incomingPending = friendRequests.filter(
    r => String(r.receiver_id) === String(currentUser.id) && r.status === "pending"
  );
  const badge = $("requestCountBadge");
  if (incomingPending.length > 0) {
    badge.textContent = incomingPending.length;
    badge.classList.remove("hidden");
  } else {
    badge.classList.add("hidden");
  }
}

function getRequestStatus(otherUserId) {
  if (!currentUser) return null;
  return friendRequests.find(
    r =>
      (String(r.sender_id) === String(currentUser.id) && String(r.receiver_id) === String(otherUserId)) ||
      (String(r.receiver_id) === String(currentUser.id) && String(r.sender_id) === String(otherUserId))
  ) || null;
}

window.sendChatRequest = async function(receiverId, event = null) {
  if (event) event.stopPropagation();
  const { error } = await supabase
    .from("friend_requests")
    .insert({ sender_id: currentUser.id, receiver_id: receiverId, status: "pending" });

  if (error) {
    toast("Failed to send request.");
  } else {
    toast("Chat request sent!");
    await loadFriendRequests();
    if (String(activeUser?.id) === String(receiverId)) openConversation(activeUser);
  }
};

window.acceptChatRequest = async function(requestId, senderProfile = null, event = null) {
  if (event) event.stopPropagation();
  const { error } = await supabase
    .from("friend_requests")
    .update({ status: "accepted" })
    .eq("id", requestId);

  if (error) {
    toast("Failed to accept request.");
  } else {
    toast("Request accepted! You can now chat.");
    await loadFriendRequests();
    await loadStories();
    if (senderProfile) {
      switchSidebarTab("chats");
      openConversation(senderProfile);
    } else if (activeUser) {
      openConversation(activeUser);
    }
  }
};

window.declineChatRequest = async function(requestId, event = null) {
  if (event) event.stopPropagation();
  const { error } = await supabase
    .from("friend_requests")
    .delete()
    .eq("id", requestId);

  if (error) {
    toast("Failed to cancel/decline request.");
  } else {
    toast("Request removed.");
    await loadFriendRequests();
    if (activeUser) openConversation(activeUser);
  }
};

async function loadPeople() {
  const { data: peopleData, error: peopleError } = await supabase
    .from("profiles")
    .select("id, display_name, avatar_url, last_seen, is_online")
    .neq("id", currentUser.id)
    .order("display_name", { ascending: true });

  if (peopleError) return;

  const { data: unreadData } = await supabase
    .from("messages")
    .select("sender_id")
    .eq("recipient_id", currentUser.id)
    .eq("is_read", false);

  if (unreadData) {
    unreadCounts = unreadData.reduce((acc, msg) => {
      acc[msg.sender_id] = (acc[msg.sender_id] || 0) + 1;
      return acc;
    }, {});
  }

  profiles = peopleData || [];
  renderAllLists();
}

function renderAllLists() {
  renderAcceptedChats();
  renderRoomsList();
  renderRequestInbox();
  renderAllUsersDirectory();
}

// 1. CHATS TAB: Shows ONLY accepted users (with Online & Last Seen)
function renderAcceptedChats() {
  const acceptedUserIds = new Set(
    friendRequests
      .filter(r => r.status === "accepted")
      .map(r => (String(r.sender_id) === String(currentUser.id) ? String(r.receiver_id) : String(r.sender_id)))
  );

  const acceptedProfiles = profiles.filter(p => {
    if (!acceptedUserIds.has(String(p.id))) return false;
    return (p.display_name || "Member").toLowerCase().includes(searchQuery.toLowerCase());
  });

  const list = $("chatUserList");
  list.replaceChildren();

  if (!acceptedProfiles.length) {
    const p = document.createElement("p");
    p.className = "empty-hint";
    p.textContent = searchQuery
      ? "No accepted chats match your search."
      : "No active chats yet. Go to Users to send a request!";
    list.append(p);
    return;
  }

  acceptedProfiles.forEach(profile => {
    const item = document.createElement("div");
    item.className = "user-item" + (String(activeUser?.id) === String(profile.id) ? " selected" : "");
    item.addEventListener("click", () => openConversation(profile));

    const img = document.createElement("img");
    img.className = "avatar";
    img.src = avatarUrl(profile.avatar_url, profile.display_name);
    img.alt = "";

    const info = document.createElement("div");
    info.className = "user-info";

    const name = document.createElement("strong");
    name.textContent = profile.display_name || "Member";

    const isOnline = isUserOnline(profile);
    const status = document.createElement("span");
    status.textContent = isOnline ? "Online" : `Last seen ${formatLastSeen(profile.last_seen)}`;
    status.style.color = isOnline ? "#20a77a" : "#a19db4";
    info.append(name, status);

    const count = unreadCounts[profile.id] || 0;
    if (count > 0 && String(activeUser?.id) !== String(profile.id)) {
      const badge = document.createElement("span");
      badge.className = "unread-badge";
      badge.textContent = count > 99 ? "99+" : count;
      item.append(badge);
    }

    const dot = document.createElement("i");
    dot.className = "status-dot" + (isOnline ? " online" : "");

    item.append(img, info, dot);
    list.append(item);
  });
}

// 2. REQUESTS TAB: Shows ONLY pending requests (never accepted users)
function renderRequestInbox() {
  const list = $("requestList");
  list.replaceChildren();

  const incomingPending = friendRequests.filter(
    r => String(r.receiver_id) === String(currentUser.id) && r.status === "pending"
  );
  const outgoingPending = friendRequests.filter(
    r => String(r.sender_id) === String(currentUser.id) && r.status === "pending"
  );

  if (!incomingPending.length && !outgoingPending.length) {
    const p = document.createElement("p");
    p.className = "empty-hint";
    p.textContent = "No pending chat requests.";
    list.append(p);
    return;
  }

  // Incoming Requests
  incomingPending.forEach(req => {
    const sender = profiles.find(p => String(p.id) === String(req.sender_id));
    const senderName = sender?.display_name || "New User";

    const card = document.createElement("div");
    card.className = "request-card";

    const img = document.createElement("img");
    img.className = "avatar";
    img.src = avatarUrl(sender?.avatar_url, senderName);
    img.alt = "";

    const info = document.createElement("div");
    info.className = "user-info";
    const nameEl = document.createElement("strong");
    nameEl.textContent = senderName;
    const subEl = document.createElement("span");
    subEl.textContent = "Wants to chat with you";
    info.append(nameEl, subEl);

    const actions = document.createElement("div");
    actions.className = "request-actions";

    const acceptBtn = document.createElement("button");
    acceptBtn.className = "req-btn req-accept";
    acceptBtn.textContent = "Accept";
    acceptBtn.onclick = (e) => acceptChatRequest(req.id, sender, e);

    const declineBtn = document.createElement("button");
    declineBtn.className = "req-btn req-decline";
    declineBtn.textContent = "Decline";
    declineBtn.onclick = (e) => declineChatRequest(req.id, e);

    actions.append(acceptBtn, declineBtn);
    card.append(img, info, actions);
    list.append(card);
  });

  // Outgoing Sent Requests
  outgoingPending.forEach(req => {
    const receiver = profiles.find(p => String(p.id) === String(req.receiver_id));
    const receiverName = receiver?.display_name || "Member";

    const card = document.createElement("div");
    card.className = "request-card";

    const img = document.createElement("img");
    img.className = "avatar";
    img.src = avatarUrl(receiver?.avatar_url, receiverName);
    img.alt = "";

    const info = document.createElement("div");
    info.className = "user-info";
    const nameEl = document.createElement("strong");
    nameEl.textContent = receiverName;
    const subEl = document.createElement("span");
    subEl.textContent = "Request sent • Waiting...";
    info.append(nameEl, subEl);

    const actions = document.createElement("div");
    actions.className = "request-actions";

    const cancelBtn = document.createElement("button");
    cancelBtn.className = "req-btn req-decline";
    cancelBtn.textContent = "Cancel";
    cancelBtn.onclick = (e) => declineChatRequest(req.id, e);

    actions.append(cancelBtn);
    card.append(img, info, actions);
    list.append(card);
  });
}

// 3. USERS TAB: Shows ONLY users with NO pending or accepted request (No last seen)
function renderAllUsersDirectory() {
  const unconnectedUsers = profiles.filter(p => {
    if (String(p.id) === String(currentUser?.id)) return false;
    if (getRequestStatus(p.id)) return false;
    return (p.display_name || "Member").toLowerCase().includes(searchQuery.toLowerCase());
  });

  const list = $("allUsersList");
  list.replaceChildren();

  if (!unconnectedUsers.length) {
    const p = document.createElement("p");
    p.className = "empty-hint";
    p.textContent = searchQuery ? "No new users found matching search." : "No new users to add right now.";
    list.append(p);
    return;
  }

  unconnectedUsers.forEach(profile => {
    const item = document.createElement("div");
    item.className = "user-item" + (String(activeUser?.id) === String(profile.id) ? " selected" : "");
    item.addEventListener("click", () => openConversation(profile));

    const img = document.createElement("img");
    img.className = "avatar";
    img.src = avatarUrl(profile.avatar_url, profile.display_name);
    img.alt = "";

    const info = document.createElement("div");
    info.className = "user-info";
    const name = document.createElement("strong");
    name.textContent = profile.display_name || "Member";
    info.append(name);

    const actionBtn = document.createElement("button");
    actionBtn.className = "user-action-chip chip-add";
    actionBtn.textContent = "+ Request";
    actionBtn.onclick = (e) => sendChatRequest(profile.id, e);

    item.append(img, info, actionBtn);
    list.append(item);
  });
}

$("userSearchInput").addEventListener("input", (e) => {
  searchQuery = e.target.value.trim();
  renderAllLists();
});

$("userSearchBtn").addEventListener("click", () => {
  searchQuery = $("userSearchInput").value.trim();
  renderAllLists();
});

// ==========================================
// WEBRTC AUDIO & VIDEO CALLING ENGINE
// ==========================================

function formatCallTime(totalSecs) {
  const mins = String(Math.floor(totalSecs / 60)).padStart(2, "0");
  const secs = String(totalSecs % 60).padStart(2, "0");
  return `${mins}:${secs}`;
}

function startCallTimer() {
  clearInterval(callTimerInterval);
  callSeconds = 0;
  $("callTimer").textContent = "00:00";
  callTimerInterval = setInterval(() => {
    callSeconds++;
    $("callTimer").textContent = formatCallTime(callSeconds);
  }, 1000);
}

function stopCallTimer() {
  clearInterval(callTimerInterval);
  callSeconds = 0;
  $("callTimer").textContent = "00:00";
}

function createPeerConnection(targetUserId) {
  const pc = new RTCPeerConnection(ICE_SERVERS);

  if (localStream) {
    localStream.getTracks().forEach(track => pc.addTrack(track, localStream));
  }

  remoteStream = new MediaStream();
  $("remoteVideo").srcObject = remoteStream;

  pc.ontrack = (event) => {
    event.streams[0].getTracks().forEach(track => remoteStream.addTrack(track));
    if (isVideoCall) $("audioCallAvatarStage").classList.add("hidden");
  };

  pc.onicecandidate = (event) => {
    if (event.candidate && callChannel) {
      callChannel.send({
        type: "broadcast",
        event: "ice-candidate",
        payload: {
          sender_id: currentUser.id,
          recipient_id: targetUserId,
          candidate: event.candidate
        }
      });
    }
  };

  pc.onconnectionstatechange = () => {
    if (pc.connectionState === "connected") {
      $("callStatusText").textContent = "Connected";
      startCallTimer();
    } else if (["disconnected", "failed", "closed"].includes(pc.connectionState)) {
      endCallCleanup(false);
    }
  };

  return pc;
}

async function startCall(videoEnabled) {
  if (!activeUser) return;
  const req = getRequestStatus(activeUser.id);
  if (!req || req.status !== "accepted") {
    toast("You can only call users who accepted your chat request.");
    return;
  }

  isVideoCall = videoEnabled;
  activeCallPeerId = activeUser.id;
  pendingIceCandidates = [];

  try {
    localStream = await navigator.mediaDevices.getUserMedia({
      audio: true,
      video: videoEnabled ? { facingMode: "user" } : false
    });
  } catch (err) {
    toast("Microphone/Camera permission denied or unavailable.");
    return;
  }

  setupCallOverlayUI(activeUser, videoEnabled, "Calling...");

  peerConnection = createPeerConnection(activeCallPeerId);
  const offer = await peerConnection.createOffer();
  await peerConnection.setLocalDescription(offer);

  callChannel.send({
    type: "broadcast",
    event: "call-offer",
    payload: {
      sender_id: currentUser.id,
      sender_name: myProfile?.display_name || "Member",
      sender_avatar: myProfile?.avatar_url || null,
      recipient_id: activeCallPeerId,
      is_video: videoEnabled,
      offer
    }
  });
}

function setupCallOverlayUI(peerProfile, videoEnabled, initialStatus) {
  isMicMuted = false;
  isCameraOff = !videoEnabled;
  $("toggleMicBtn").classList.remove("off");
  $("toggleMicBtn").textContent = "🎤";

  $("toggleCamBtn").classList.toggle("hidden", !videoEnabled);
  $("toggleCamBtn").classList.remove("off");
  $("toggleCamBtn").textContent = "📷";

  $("callPeerName").textContent = peerProfile?.display_name || "Member";
  $("callPeerAvatar").src = avatarUrl(peerProfile?.avatar_url, peerProfile?.display_name);
  $("callStatusText").textContent = initialStatus;
  $("audioCallAvatarStage").classList.remove("hidden");

  if (videoEnabled && localStream) {
    $("localVideo").srcObject = localStream;
    $("localVideo").classList.remove("hidden");
  } else {
    $("localVideo").classList.add("hidden");
  }

  $("callOverlay").classList.remove("hidden");
}

$("audioCallBtn").addEventListener("click", () => startCall(false));
$("videoCallBtn").addEventListener("click", () => startCall(true));

$("acceptCallBtn").addEventListener("click", async () => {
  if (!incomingOfferPayload) return;
  const payload = incomingOfferPayload;
  incomingOfferPayload = null;
  $("incomingCallModal").classList.add("hidden");

  isVideoCall = payload.is_video;
  activeCallPeerId = payload.sender_id;

  try {
    localStream = await navigator.mediaDevices.getUserMedia({
      audio: true,
      video: isVideoCall ? { facingMode: "user" } : false
    });
  } catch (err) {
    toast("Unable to access microphone/camera.");
    declineIncomingCall(payload.sender_id);
    return;
  }

  const callerProfile = profiles.find(p => String(p.id) === String(payload.sender_id)) || {
    display_name: payload.sender_name,
    avatar_url: payload.sender_avatar
  };

  setupCallOverlayUI(callerProfile, isVideoCall, "Connecting...");

  peerConnection = createPeerConnection(activeCallPeerId);
  await peerConnection.setRemoteDescription(new RTCSessionDescription(payload.offer));

  for (const cand of pendingIceCandidates) {
    await peerConnection.addIceCandidate(new RTCIceCandidate(cand));
  }
  pendingIceCandidates = [];

  const answer = await peerConnection.createAnswer();
  await peerConnection.setLocalDescription(answer);

  callChannel.send({
    type: "broadcast",
    event: "call-answer",
    payload: {
      sender_id: currentUser.id,
      recipient_id: activeCallPeerId,
      answer
    }
  });
});

function declineIncomingCall(callerId) {
  if (callChannel && callerId) {
    callChannel.send({
      type: "broadcast",
      event: "call-end",
      payload: { sender_id: currentUser.id, recipient_id: callerId, reason: "declined" }
    });
  }
  incomingOfferPayload = null;
  pendingIceCandidates = [];
  $("incomingCallModal").classList.add("hidden");
}

$("declineCallBtn").addEventListener("click", () => {
  if (incomingOfferPayload) declineIncomingCall(incomingOfferPayload.sender_id);
});

$("toggleMicBtn").addEventListener("click", () => {
  if (!localStream) return;
  isMicMuted = !isMicMuted;
  localStream.getAudioTracks().forEach(track => (track.enabled = !isMicMuted));
  $("toggleMicBtn").classList.toggle("off", isMicMuted);
  $("toggleMicBtn").textContent = isMicMuted ? "🔇" : "🎤";
});

$("toggleCamBtn").addEventListener("click", () => {
  if (!localStream || !isVideoCall) return;
  isCameraOff = !isCameraOff;
  localStream.getVideoTracks().forEach(track => (track.enabled = !isCameraOff));
  $("toggleCamBtn").classList.toggle("off", isCameraOff);
  $("toggleCamBtn").textContent = isCameraOff ? "🚫" : "📷";
});

$("hangupCallBtn").addEventListener("click", () => endCallCleanup(true));

function endCallCleanup(notifyPeer = true) {
  if (notifyPeer && activeCallPeerId && callChannel) {
    callChannel.send({
      type: "broadcast",
      event: "call-end",
      payload: { sender_id: currentUser.id, recipient_id: activeCallPeerId, reason: "ended" }
    });
  }

  stopCallTimer();
  if (peerConnection) { peerConnection.close(); peerConnection = null; }
  if (localStream) { localStream.getTracks().forEach(track => track.stop()); localStream = null; }

  remoteStream = null;
  activeCallPeerId = null;
  incomingOfferPayload = null;
  pendingIceCandidates = [];

  $("remoteVideo").srcObject = null;
  $("localVideo").srcObject = null;
  $("callOverlay").classList.add("hidden");
  $("incomingCallModal").classList.add("hidden");
}

// ==========================================
// REALTIME PRESENCE & CHANNELS
// ==========================================

async function startPresence() {
  await supabase.removeAllChannels();
  presenceChannel = null;
  messageChannel = null;
  typingChannel = null;
  requestChannel = null;
  globalMessageNotifierChannel = null;
  callChannel = null;
  socialRealtimeChannel = null;

  await setOnlineStatusInDB(true);
  await loadFriendRequests();
  await loadStories();
  await loadRooms();

  const syncPresenceState = () => {
    if (!presenceChannel) return;
    const state = presenceChannel.presenceState();
    onlineUsersMap.clear();

    Object.entries(state).forEach(([presenceKey, metas]) => {
      onlineUsersMap.set(String(presenceKey), metas[0]);
      metas.forEach(meta => {
        if (meta.user_id) onlineUsersMap.set(String(meta.user_id), meta);
      });
    });

    renderAcceptedChats();
    if (activeUser) updateActiveStatus();
  };

  presenceChannel = supabase.channel("waibhav-presence", {
    config: { presence: { key: String(currentUser.id) } }
  });

  presenceChannel
    .on("presence", { event: "sync" }, syncPresenceState)
    .on("presence", { event: "join" }, syncPresenceState)
    .on("presence", { event: "leave" }, ({ key }) => {
      if (key) onlineUsersMap.delete(String(key));
      const idx = profiles.findIndex(p => String(p.id) === String(key));
      if (idx !== -1) {
        profiles[idx].is_online = false;
        profiles[idx].last_seen = new Date().toISOString();
      }
      renderAcceptedChats();
      if (activeUser) updateActiveStatus();
    })
    .subscribe(async (status, err) => {
      if (status === "SUBSCRIBED" && document.visibilityState === "visible") {
        await presenceChannel.track({
          user_id: String(currentUser.id),
          online_at: new Date().toISOString()
        });
      } else if (err) {
        console.error("Presence subscription error:", err);
      }
    });

  typingChannel = supabase.channel("waibhav-typing")
    .on("broadcast", { event: "typing" }, (payload) => {
      if (String(payload.sender_id) === String(activeUser?.id) && String(payload.recipient_id) === String(currentUser.id)) {
        showTypingIndicator(payload.is_typing);
      }
    })
    .subscribe();

  callChannel = supabase.channel("waibhav-calls")
    .on("broadcast", { event: "call-offer" }, ({ payload }) => {
      if (String(payload?.recipient_id) !== String(currentUser.id)) return;

      if (activeCallPeerId || incomingOfferPayload) {
        callChannel.send({
          type: "broadcast",
          event: "call-end",
          payload: { sender_id: currentUser.id, recipient_id: payload.sender_id, reason: "busy" }
        });
        return;
      }

      incomingOfferPayload = payload;
      pendingIceCandidates = [];
      $("incomingCallerName").textContent = payload.sender_name || "Member";
      $("incomingCallerAvatar").src = avatarUrl(payload.sender_avatar, payload.sender_name);
      $("incomingCallType").textContent = payload.is_video ? "Incoming Video Call..." : "Incoming Audio Call...";
      $("incomingCallModal").classList.remove("hidden");
    })
    .on("broadcast", { event: "call-answer" }, async ({ payload }) => {
      if (String(payload?.recipient_id) !== String(currentUser.id) || !peerConnection) return;
      await peerConnection.setRemoteDescription(new RTCSessionDescription(payload.answer));
      for (const cand of pendingIceCandidates) {
        await peerConnection.addIceCandidate(new RTCIceCandidate(cand));
      }
      pendingIceCandidates = [];
    })
    .on("broadcast", { event: "ice-candidate" }, async ({ payload }) => {
      if (String(payload?.recipient_id) !== String(currentUser.id)) return;
      if (peerConnection && peerConnection.remoteDescription) {
        await peerConnection.addIceCandidate(new RTCIceCandidate(payload.candidate));
      } else {
        pendingIceCandidates.push(payload.candidate);
      }
    })
    .on("broadcast", { event: "call-end" }, ({ payload }) => {
      if (String(payload?.recipient_id) !== String(currentUser.id)) return;
      if (payload.reason === "declined") toast("Call declined.");
      else if (payload.reason === "busy") toast("User is on another call.");
      else toast("Call ended.");
      endCallCleanup(false);
    })
    .subscribe();

  requestChannel = supabase.channel("waibhav-requests")
    .on("postgres_changes", { event: "*", schema: "public", table: "friend_requests" }, async (payload) => {
      const newReq = payload.new;
      if (payload.eventType === "INSERT" && String(newReq?.receiver_id) === String(currentUser.id)) {
        await loadPeople();
        const sender = profiles.find(p => String(p.id) === String(newReq.sender_id));
        toast(`🔔 ${sender?.display_name || "Someone"} sent you a chat request!`);
      } else if (payload.eventType === "UPDATE" && String(newReq?.sender_id) === String(currentUser.id) && newReq?.status === "accepted") {
        const accepter = profiles.find(p => String(p.id) === String(newReq.receiver_id));
        toast(`✅ ${accepter?.display_name || "Someone"} accepted your chat request!`);
      }
      await loadFriendRequests();
      await loadStories();
      if (activeUser) openConversation(activeUser);
    })
    .subscribe();

  globalMessageNotifierChannel = supabase.channel("waibhav-global-message-notifications")
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages" }, async (payload) => {
      const newMsg = payload.new;
      if (newMsg && String(newMsg.recipient_id) === String(currentUser.id)) {
        if (!activeUser || String(activeUser.id) !== String(newMsg.sender_id)) {
          let sender = profiles.find(p => String(p.id) === String(newMsg.sender_id));
          if (!sender) {
            await loadPeople();
            sender = profiles.find(p => String(p.id) === String(newMsg.sender_id));
          }
          const senderName = sender?.display_name || "Someone";
          const preview = newMsg.body.startsWith("[IMAGE]:") ? "📷 Sent a photo" : newMsg.body;
          toast(`💬 ${senderName}: ${preview}`);
          unreadCounts[newMsg.sender_id] = (unreadCounts[newMsg.sender_id] || 0) + 1;
          renderAllLists();
        }
      }
    })
    .subscribe();

  socialRealtimeChannel = supabase.channel("waibhav-social-updates")
    .on("postgres_changes", { event: "*", schema: "public", table: "stories" }, async () => {
      await loadStories();
    })
    .on("postgres_changes", { event: "*", schema: "public", table: "rooms" }, async () => {
      await loadRooms();
    })
    .on("postgres_changes", { event: "UPDATE", schema: "public", table: "profiles" }, (payload) => {
      const updated = payload.new;
      if (!updated) return;
      const idx = profiles.findIndex(p => String(p.id) === String(updated.id));
      if (idx !== -1) {
        profiles[idx] = { ...profiles[idx], ...updated };
        if (String(activeUser?.id) === String(updated.id)) {
          activeUser = profiles[idx];
          updateActiveStatus();
        }
        renderAcceptedChats();
      }
    })
    .subscribe();
}

function updateActiveStatus() {
  if (!activeUser) return;
  const req = getRequestStatus(activeUser.id);
  const statusEl = $("activeStatus");

  if (!req || req.status !== "accepted") {
    statusEl.textContent = "";
    return;
  }

  const isOnline = isUserOnline(activeUser);
  statusEl.textContent = isOnline ? "● Online" : `Last seen ${formatLastSeen(activeUser.last_seen)}`;
  statusEl.style.color = isOnline ? "#20a77a" : "#9693aa";
}

function showTypingIndicator(isTyping) {
  const banner = $("typingBanner");
  if (isTyping) {
    $("typingText").textContent = `${activeUser?.display_name || "Member"} is typing...`;
    banner.classList.remove("hidden");
  } else {
    banner.classList.add("hidden");
  }
}

function sendTypingEvent(isTyping) {
  if (!activeUser || !typingChannel) return;
  typingChannel.send({
    type: "broadcast",
    event: "typing",
    payload: {
      sender_id: currentUser.id,
      recipient_id: activeUser.id,
      is_typing: isTyping
    }
  });
}

$("messageInput").addEventListener("input", () => {
  if (!activeUser) return;
  sendTypingEvent(true);
  clearTimeout(typingTimeout);
  typingTimeout = setTimeout(() => sendTypingEvent(false), 1800);
});

async function openConversation(profile) {
  activeRoom = null;
  activeUser = profile;
  unreadCounts[profile.id] = 0;
  showTypingIndicator(false);

  chatScreen.classList.add("mobile-chat-active");
  $("welcomePanel").classList.add("hidden");
  $("conversationPanel").classList.remove("hidden");
  $("activeName").textContent = profile.display_name || "Member";
  $("activeAvatar").src = avatarUrl(profile.avatar_url, profile.display_name);
  updateActiveStatus();
  renderAllLists();

  $("roomHeaderActions").classList.add("hidden");
  const request = getRequestStatus(profile.id);
  $("callHeaderActions").classList.toggle("hidden", !request || request.status !== "accepted");

  const box = $("messages");

  if (!request) {
    box.innerHTML = `
      <div style="display:flex; flex-direction:column; align-items:center; justify-content:center; height:100%; text-align:center; padding:20px; gap:12px;">
        <p style="color:#666; font-size:14px; margin:0;">Send a chat request to <strong>${profile.display_name}</strong> to start messaging.</p>
        <button class="primary-btn" style="width:auto; padding:12px 24px; margin-top:0;" onclick="sendChatRequest('${profile.id}')">Send Request 👋</button>
      </div>
    `;
    $("messageForm").classList.add("hidden");
    return;
  } else if (request.status === "pending" && String(request.sender_id) === String(currentUser.id)) {
    box.innerHTML = `
      <div style="display:flex; flex-direction:column; align-items:center; justify-content:center; height:100%; text-align:center; padding:20px; gap:8px;">
        <p style="color:#666; font-size:14px; margin:0;">Chat request sent to <strong>${profile.display_name}</strong>.</p>
        <span class="muted tiny">Waiting for acceptance...</span>
      </div>
    `;
    $("messageForm").classList.add("hidden");
    return;
  } else if (request.status === "pending" && String(request.receiver_id) === String(currentUser.id)) {
    box.innerHTML = `
      <div style="display:flex; flex-direction:column; align-items:center; justify-content:center; height:100%; text-align:center; padding:20px; gap:12px;">
        <p style="color:#666; font-size:14px; margin:0;"><strong>${profile.display_name}</strong> wants to send you a message.</p>
        <div style="display:flex; gap:10px;">
          <button class="primary-btn" style="width:auto; padding:11px 22px; margin-top:0;" onclick="acceptChatRequest('${request.id}')">Accept ✓</button>
          <button class="req-btn req-decline" style="padding:11px 18px; border-radius:12px;" onclick="declineChatRequest('${request.id}')">Decline</button>
        </div>
      </div>
    `;
    $("messageForm").classList.add("hidden");
    return;
  }

  $("messageForm").classList.remove("hidden");

  if (messageCache[profile.id]) {
    renderCachedMessages(messageCache[profile.id]);
  } else {
    box.replaceChildren();
    const loading = document.createElement("p");
    loading.className = "empty-hint";
    loading.textContent = "Loading conversation...";
    box.append(loading);
  }

  await supabase
    .from("messages")
    .update({ is_read: true })
    .eq("sender_id", profile.id)
    .eq("recipient_id", currentUser.id)
    .eq("is_read", false);

  await loadMessages();

  if (messageChannel) await supabase.removeChannel(messageChannel);

  messageChannel = supabase.channel(`dm-chat-${profile.id}-${Date.now()}`)
    .on("postgres_changes", { event: "*", schema: "public", table: "messages" }, async (payload) => {
      const msg = payload.new || payload.old;
      const belongsHere =
        (String(msg?.sender_id) === String(currentUser.id) && String(msg?.recipient_id) === String(activeUser?.id)) ||
        (String(msg?.sender_id) === String(activeUser?.id) && String(msg?.recipient_id) === String(currentUser.id));

      if (belongsHere || payload.eventType === "DELETE") {
        if (payload.eventType === "INSERT" && String(msg.recipient_id) === String(currentUser.id)) {
          await supabase.from("messages").update({ is_read: true }).eq("id", msg.id);
        }
        await loadMessages();
      }
    })
    .subscribe();
}

$("backToListBtn").addEventListener("click", () => {
  chatScreen.classList.remove("mobile-chat-active");
  activeUser = null;
  activeRoom = null;
  showTypingIndicator(false);
  renderAllLists();
});

async function deleteMessage(messageId) {
  if (!confirm("Delete this message for everyone?")) return;

  const { error } = await supabase
    .from("messages")
    .delete()
    .eq("id", messageId)
    .eq("sender_id", currentUser.id);

  if (error) {
    toast("Failed to delete message.");
  } else {
    toast("Message deleted.");
    await loadMessages();
  }
}

async function loadMessages() {
  if (!activeUser) return;
  const targetUserId = activeUser.id;

  const { data, error } = await supabase
    .from("messages")
    .select("*")
    .or(`and(sender_id.eq.${currentUser.id},recipient_id.eq.${targetUserId}),and(sender_id.eq.${targetUserId},recipient_id.eq.${currentUser.id})`)
    .order("created_at", { ascending: true })
    .limit(50);

  if (String(activeUser?.id) !== String(targetUserId)) return;
  if (error) { toast(error.message); return; }

  messageCache[targetUserId] = data || [];
  renderCachedMessages(data || []);
}

function renderCachedMessages(messagesData) {
  const box = $("messages");
  box.replaceChildren();

  if (!messagesData.length) {
    const p = document.createElement("p");
    p.className = "empty-hint";
    p.textContent = "No messages yet. Say hello 👋";
    box.append(p);
  } else {
    messagesData.forEach(message => {
      const isMine = String(message.sender_id) === String(currentUser.id);
      const bubble = document.createElement("div");
      bubble.className = "message " + (isMine ? "mine" : "theirs");

      const body = document.createElement("div");

      if (message.body.startsWith("[IMAGE]:")) {
        const imgUrl = message.body.replace("[IMAGE]:", "");
        const img = document.createElement("img");
        img.src = imgUrl;
        img.className = "chat-photo-attachment";
        img.loading = "lazy";
        img.onclick = () => window.open(imgUrl, "_blank");
        body.append(img);
      } else {
        body.textContent = message.body;
      }

      const footer = document.createElement("div");
      footer.className = "message-footer";

      const time = document.createElement("time");
      time.textContent = new Date(message.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
      footer.append(time);

      if (isMine) {
        const statusTicks = document.createElement("span");
        statusTicks.className = "read-status " + (message.is_read ? "read" : "unread");
        statusTicks.textContent = message.is_read ? " ✓✓" : " ✓";
        footer.append(statusTicks);

        const delBtn = document.createElement("button");
        delBtn.className = "delete-msg-btn";
        delBtn.title = "Delete message";
        delBtn.innerHTML = "🗑";
        delBtn.addEventListener("click", (e) => {
          e.stopPropagation();
          deleteMessage(message.id);
        });
        footer.append(delBtn);
      }

      bubble.append(body, footer);
      box.append(bubble);
    });
  }
  box.scrollTop = box.scrollHeight;
}

$("messageForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!activeUser && !activeRoom) return;
  const body = $("messageInput").value.trim();
  if (!body) return;

  $("messageInput").disabled = true;

  if (activeRoom) {
    const { error } = await supabase.from("room_messages").insert({
      room_id: activeRoom.id,
      sender_id: currentUser.id,
      body
    });
    $("messageInput").disabled = false;
    if (error) { toast(error.message); return; }
    $("messageInput").value = "";
    await loadRoomMessages();
    $("messageInput").focus();
    return;
  }

  sendTypingEvent(false);
  const { error } = await supabase.from("messages").insert({
    sender_id: currentUser.id,
    recipient_id: activeUser.id,
    body,
    is_read: false
  });
  $("messageInput").disabled = false;

  if (error) { toast(error.message); return; }

  $("messageInput").value = "";
  await loadMessages();
  $("messageInput").focus();
});

$("chatPhotoInput").addEventListener("change", async (event) => {
  const file = event.target.files[0];
  if (!file) return;
  if (!activeUser && !activeRoom) { toast("Select a user or room first."); return; }
  if (!file.type.startsWith("image/")) { toast("Please choose an image."); return; }
  if (file.size > 5 * 1024 * 1024) { toast("Choose an image smaller than 5 MB."); return; }

  const extension = file.name.split(".").pop().toLowerCase().replace(/[^a-z0-9]/g, "") || "jpg";
  const filePath = `${currentUser.id}/${Date.now()}.${extension}`;

  toast("Sending photo...");
  const { error: uploadError } = await supabase.storage
    .from("chat-photos")
    .upload(filePath, file, { upsert: true, contentType: file.type });

  if (uploadError) { toast(uploadError.message); return; }

  const { data: publicData } = supabase.storage.from("chat-photos").getPublicUrl(filePath);
  const photoUrl = publicData.publicUrl;

  if (activeRoom) {
    const { error: roomInsertErr } = await supabase.from("room_messages").insert({
      room_id: activeRoom.id,
      sender_id: currentUser.id,
      body: `[IMAGE]:${photoUrl}`
    });
    if (roomInsertErr) toast(roomInsertErr.message);
    else await loadRoomMessages();
  } else {
    const { error: insertError } = await supabase.from("messages").insert({
      sender_id: currentUser.id,
      recipient_id: activeUser.id,
      body: `[IMAGE]:${photoUrl}`,
      is_read: false
    });
    if (insertError) toast(insertError.message);
    else await loadMessages();
  }

  event.target.value = "";
});

$("avatarInput").addEventListener("change", async (event) => {
  const file = event.target.files[0];
  if (!file) return;
  if (!file.type.startsWith("image/")) { toast("Please choose an image."); return; }
  if (file.size > 3 * 1024 * 1024) { toast("Choose an image smaller than 3 MB."); return; }

  const extension = file.name.split(".").pop().toLowerCase().replace(/[^a-z0-9]/g, "") || "jpg";
  const path = `${currentUser.id}/${Date.now()}.${extension}`;

  toast("Uploading profile picture...");
  const { error: uploadError } = await supabase.storage.from("avatars").upload(path, file, {
    upsert: true,
    contentType: file.type
  });

  if (uploadError) { toast(uploadError.message); return; }

  const { data: publicData } = supabase.storage.from("avatars").getPublicUrl(path);
  const avatar_url = publicData.publicUrl;

  const { error: updateError } = await supabase
    .from("profiles")
    .update({ avatar_url })
    .eq("id", currentUser.id);

  if (updateError) { toast(updateError.message); return; }

  myProfile.avatar_url = avatar_url;
  $("myAvatar").src = avatarUrl(avatar_url, myProfile.display_name);
  toast("Profile picture updated!");
  event.target.value = "";
});

$("logoutBtn").addEventListener("click", async () => {
  endCallCleanup(true);
  if (presenceChannel) await presenceChannel.untrack();
  await setOnlineStatusInDB(false);
  await supabase.removeAllChannels();
  await supabase.auth.signOut();
});

async function showChat(user, session = null) {
  if (session?.access_token) currentAccessToken = session.access_token;
  if (isInitializingChat || (String(currentUser?.id) === String(user.id) && presenceChannel)) return;
  isInitializingChat = true;
  currentUser = user;

  authScreen.classList.add("hidden");
  chatScreen.classList.remove("hidden");

  try {
    await loadMyProfile();
    await loadPeople();
    await startPresence();
  } catch (error) {
    console.error("Error setting up chat UI:", error);
    toast(error.message || "Failed to load data.");
  } finally {
    isInitializingChat = false;
  }
}

supabase.auth.onAuthStateChange((_event, session) => {
  currentAccessToken = session?.access_token || null;
  if (session?.user) {
    setTimeout(() => showChat(session.user, session), 0);
  } else {
    currentUser = null;
    myProfile = null;
    activeUser = null;
    activeRoom = null;
    messageCache = {};
    roomMessageCache = {};
    authScreen.classList.remove("hidden");
    chatScreen.classList.add("hidden");
    chatScreen.classList.remove("mobile-chat-active");
    $("conversationPanel").classList.add("hidden");
    $("welcomePanel").classList.remove("hidden");
    generateCaptcha();
  }
});

const termsModal = $("termsModal");
const privacyModal = $("privacyModal");

function toggleModal(modal, show) {
  modal.classList.toggle("hidden", !show);
  modal.setAttribute("aria-hidden", !show);
}

$("termsBtn").addEventListener("click", () => toggleModal(termsModal, true));
$("termsBtnSidebar").addEventListener("click", () => toggleModal(termsModal, true));
$("closeTerms").addEventListener("click", () => toggleModal(termsModal, false));

$("privacyBtn").addEventListener("click", () => toggleModal(privacyModal, true));
$("privacyBtnSidebar").addEventListener("click", () => toggleModal(privacyModal, true));
$("closePrivacy").addEventListener("click", () => toggleModal(privacyModal, false));

[termsModal, privacyModal, $("createStoryModal"), $("createRoomModal")].forEach(modal => {
  modal.addEventListener("click", (e) => {
    if (e.target === modal) toggleModal(modal, false);
  });
});