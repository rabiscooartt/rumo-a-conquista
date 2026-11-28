"use strict";
// Janela de configurações: só escreve texto (textContent) e fala com o processo principal pela ponte.
(async () => {
  const $ = (id) => document.getElementById(id);
  const data = await window.rumo.getSettings();
  const inputs = {};

  $("hotkey").value = data.desktop.hotkey || "";
  $("startWithWindows").checked = Boolean(data.desktop.startWithWindows);
  $("captureSound").checked = data.desktop.captureSound !== false;
  $("indicatorMode").value = data.desktop.indicatorMode || "on-mark";
  $("indicatorCorner").value = data.desktop.indicatorCorner || "bottom-right";
  if (!data.packaged) {
    $("startWithWindows").disabled = true;
    $("startRow").title = "Disponível no aplicativo instalado";
  }
  if (data.hotkeyError) {
    $("hotkeyError").textContent = data.hotkeyError;
    $("hotkeyError").hidden = false;
  }
  $("dataDir").textContent = "Dados: " + data.dataDir;

  // Captura qualquer tecla (pelo código físico, independe do layout) no formato "Control+Alt+F9".
  const CODE_NAMES = {
    Pause: "Pause", ScrollLock: "ScrollLock", PrintScreen: "PrintScreen", Insert: "Insert", Delete: "Delete",
    Home: "Home", End: "End", PageUp: "PageUp", PageDown: "PageDown", ArrowUp: "Up", ArrowDown: "Down",
    ArrowLeft: "Left", ArrowRight: "Right", Space: "Space", Tab: "Tab", Escape: "Escape", Backspace: "Backspace",
    Enter: "Enter", CapsLock: "Capslock", NumLock: "Numlock", NumpadAdd: "numadd", NumpadSubtract: "numsub",
    NumpadMultiply: "nummult", NumpadDivide: "numdiv", NumpadDecimal: "numdec",
  };
  const keyName = (code) => {
    if (CODE_NAMES[code]) return CODE_NAMES[code];
    let m;
    if ((m = /^Key([A-Z])$/.exec(code))) return m[1];
    if ((m = /^Digit(\d)$/.exec(code))) return m[1];
    if ((m = /^Numpad(\d)$/.exec(code))) return "num" + m[1];
    if (/^F([1-9]|1\d|2[0-4])$/.test(code)) return code;
    return null;
  };
  const capture = (event) => {
    if (["ControlLeft", "ControlRight", "AltLeft", "AltRight", "ShiftLeft", "ShiftRight", "MetaLeft", "MetaRight"].includes(event.code)) return;
    event.preventDefault();
    const key = keyName(event.code);
    if (!key) return;
    const parts = [];
    if (event.ctrlKey) parts.push("Control");
    if (event.altKey) parts.push("Alt");
    if (event.shiftKey) parts.push("Shift");
    $("hotkey").value = [...parts, key].join("+");
  };
  $("hotkey").addEventListener("keydown", capture);
  // O Windows não envia keydown da PrintScreen: só o keyup.
  $("hotkey").addEventListener("keyup", (event) => event.code === "PrintScreen" && capture(event));
  $("hotkey-default").addEventListener("click", () => ($("hotkey").value = data.defaultHotkey || "Pause"));
  $("hotkey-clear").addEventListener("click", () => ($("hotkey").value = ""));

  for (const f of data.fields) {
    const wrap = document.createElement("label");
    if (f.type === "boolean") {
      wrap.className = "check";
      const input = document.createElement("input");
      input.type = "checkbox";
      input.checked = Boolean(data.agent[f.key]);
      wrap.append(input, document.createTextNode(" " + f.label));
      inputs[f.key] = input;
    } else {
      wrap.className = "field";
      const title = document.createElement("span");
      title.textContent = f.label;
      wrap.append(title);
      const input = document.createElement("input");
      input.type = f.type === "integer" ? "number" : "text";
      input.value = data.agent[f.key] ?? "";
      if (f.type === "folder") {
        const row = document.createElement("div");
        row.className = "row";
        const pick = document.createElement("button");
        pick.type = "button";
        pick.className = "secondary";
        pick.textContent = "Escolher…";
        pick.addEventListener("click", async () => {
          const folder = await window.rumo.pickFolder();
          if (folder) input.value = folder;
        });
        row.append(input, pick);
        wrap.append(row);
      } else {
        wrap.append(input);
      }
      if (f.help) {
        const help = document.createElement("small");
        help.textContent = f.help;
        wrap.append(help);
      }
      inputs[f.key] = input;
    }
    $("fields").append(wrap);
  }

  $("save").addEventListener("click", async () => {
    const agent = {};
    for (const f of data.fields) {
      const input = inputs[f.key];
      agent[f.key] = f.type === "boolean" ? input.checked : f.type === "integer" ? Number(input.value) : input.value;
    }
    const status = $("status");
    status.removeAttribute("data-kind");
    status.textContent = "Salvando…";
    const result = await window.rumo.saveSettings({ agent, desktop: { hotkey: $("hotkey").value, startWithWindows: $("startWithWindows").checked, captureSound: $("captureSound").checked, indicatorMode: $("indicatorMode").value, indicatorCorner: $("indicatorCorner").value } });
    if (!result.ok) {
      status.setAttribute("data-kind", "error");
      status.textContent = result.problems.join("\n");
      return;
    }
    status.setAttribute("data-kind", "ok");
    status.textContent = result.restarted ? "Salvo. O agente foi reiniciado com a nova configuração." : "Salvo.";
    $("hotkeyError").hidden = !result.hotkeyError;
    $("hotkeyError").textContent = result.hotkeyError || "";
  });
})();
