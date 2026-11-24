import type { NextConfig } from "next";

// Cabeçalhos de proteção básicos. Uma CSP completa ficou de fora de propósito: o site embute
// players do YouTube e da Twitch e imagens de vários domínios, e uma regra errada quebraria a página.
const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  { key: "Content-Security-Policy", value: "frame-ancestors 'self'" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()" },
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // Perfil e Histórico de troféus foram retirados: o perfil já está na página inicial e as
  // conquistas na Atividade. Links antigos seguem funcionando (redirecionamento temporário).
  async redirects() {
    return [
      { source: "/perfil", destination: "/", permanent: false },
      { source: "/historico", destination: "/atividade", permanent: false },
    ];
  },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
