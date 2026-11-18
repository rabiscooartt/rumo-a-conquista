// Servidores simulados das suítes (Supabase falso em 127.0.0.1): porta conferida antes de escutar,
// prazo para começar e encerramento garantido. A faixa 24412 e 24421–24430 fica fora das portas
// temporárias do Linux (32768–60999) e do Windows (49152–65535): uma conexão de saída (por exemplo,
// do PostgreSQL) nunca ocupa a porta de um servidor simulado.
import net from "node:net";

const HOST = "127.0.0.1";

/** Falha com diagnóstico se a porta estiver ocupada; nunca espera mais que `timeoutMs`. */
export function assertPortFree(port, { host = HOST, timeoutMs = 3000, label = "porta" } = {}) {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    const timer = setTimeout(() => {
      probe.close();
      reject(new Error(`${label}: a verificação de ${host}:${port} não respondeu em ${timeoutMs} ms`));
    }, timeoutMs);
    probe.once("error", (error) => {
      clearTimeout(timer);
      reject(new Error(error.code === "EADDRINUSE"
        ? `${label}: ${host}:${port} já está em uso por outro processo (EADDRINUSE). Encerre-o ou libere a porta antes de rodar os testes.`
        : `${label}: ${host}:${port} indisponível (${error.code ?? error.message})`));
    });
    probe.listen({ port, host, exclusive: true }, () => {
      clearTimeout(timer);
      probe.close(() => resolve());
    });
  });
}

/**
 * Confere a porta, inicia o servidor com prazo e devolve a função que o encerra (idempotente,
 * fecha também conexões abertas). Use em `finally`.
 */
export async function startServer(server, port, label, { host = HOST, timeoutMs = 5000 } = {}) {
  await assertPortFree(port, { host, timeoutMs, label });
  await new Promise((resolve, reject) => {
    const onError = (error) => {
      clearTimeout(timer);
      reject(new Error(`${label}: o servidor simulado não conseguiu escutar em ${host}:${port} (${error.code ?? error.message})`));
    };
    const timer = setTimeout(() => {
      server.off("error", onError);
      server.close();
      reject(new Error(`${label}: o servidor simulado não começou a escutar em ${host}:${port} em ${timeoutMs} ms`));
    }, timeoutMs);
    server.once("error", onError);
    server.listen(port, host, () => {
      clearTimeout(timer);
      server.off("error", onError);
      resolve();
    });
  });
  let stopped = false;
  return async function stopServer() {
    if (stopped) return;
    stopped = true;
    server.closeAllConnections?.();
    await new Promise((resolve) => {
      const timer = setTimeout(resolve, timeoutMs);
      server.close(() => { clearTimeout(timer); resolve(); });
    });
  };
}
