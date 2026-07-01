const $ = (id) => document.getElementById(id);

async function refresh() {
  const s = await chrome.runtime.sendMessage({ type: "status" });
  if (s?.paired) {
    $("unpaired").style.display = "none";
    $("paired").style.display = "block";
    $("dev").textContent = (s.device_id || "").slice(0, 8);
  } else {
    $("unpaired").style.display = "block";
    $("paired").style.display = "none";
  }
}

$("pair").addEventListener("click", async () => {
  const code = $("code").value.trim();
  if (!code) return;
  $("msg").textContent = "Linking…";
  const r = await chrome.runtime.sendMessage({ type: "pair", code });
  if (r?.ok) {
    $("msg").innerHTML = '<span class="ok">Linked ✓</span>';
    refresh();
  } else {
    $("msg").innerHTML = '<span class="err">' + (r?.error || "Failed") + "</span>";
  }
});

$("unpair").addEventListener("click", async () => {
  await chrome.runtime.sendMessage({ type: "unpair" });
  refresh();
});

refresh();
