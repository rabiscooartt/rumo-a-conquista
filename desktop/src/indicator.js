"use strict";
// Indicador na tela: o processo principal chama window.rumoIndicator.* (só texto via textContent).
(() => {
  const pill = document.getElementById("pill");
  const title = document.getElementById("title");
  const detail = document.getElementById("detail");
  let timer = null;
  let persistent = true;

  const rest = () => {
    pill.setAttribute("data-state", "idle");
    pill.setAttribute("data-hidden", persistent ? "0" : "1");
  };

  window.rumoIndicator = {
    configure({ icon, corner, alwaysVisible }) {
      if (icon) document.getElementById("icon").src = icon;
      document.body.setAttribute("data-corner", corner || "bottom-right");
      persistent = alwaysVisible !== false;
      if (pill.getAttribute("data-state") === "idle") rest();
    },
    /** state: "marking" | "ok" | "error" */
    show(state, text, sub, ms) {
      if (timer) clearTimeout(timer);
      pill.setAttribute("data-hidden", "0");
      pill.setAttribute("data-state", state);
      title.textContent = text || "";
      detail.textContent = sub || "";
      if (ms) timer = setTimeout(rest, ms);
    },
  };
  rest();
})();
