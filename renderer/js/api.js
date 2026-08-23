const socket = io(window.orbit.serverUrl, { transports: ['websocket', 'polling'] });

function emit(event, payload = {}) {
  return new Promise((resolve, reject) => {
    socket.emit(event, payload, (response) => {
      if (response && response.error) reject(new Error(response.error));
      else resolve(response);
    });
  });
}

function on(event, handler) {
  socket.on(event, handler);
  return () => socket.off(event, handler);
}

export { socket, emit, on };
