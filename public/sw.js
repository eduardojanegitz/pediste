// Service worker do Pediste: só trata notificações push. Não guarda nada em cache.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

// O push chega sem conteúdo (só serve de aviso): o texto é fixo.
self.addEventListener("push", (event) => {
  event.waitUntil(
    self.registration.showNotification("Seu pedido está pronto! 🎉", {
      body: "Pode retirar. Toque para abrir o Pediste.",
      icon: "/icons/icon-192.png",
      badge: "/icons/icon-192.png",
      tag: "pediste-ready",
      renotify: true,
      vibrate: [200, 100, 200],
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      for (const c of list) {
        if ("focus" in c) return c.focus();
      }
      return self.clients.openWindow("/");
    }),
  );
});
