// Thin wrapper over the server's JSON API.
async function call(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `${res.status} ${res.statusText}`);
  return data;
}

export const api = {
  info: () => call('GET', '/api/info'),
  maps: () => call('GET', '/api/maps'),
  importOsm: mapId => call('POST', `/api/maps/${mapId}/import-osm`),
  saveMap: map => (map.id ? call('PUT', `/api/maps/${map.id}`, map) : call('POST', '/api/maps', map)),
  rounds: () => call('GET', '/api/rounds'),
  today: date => call('GET', `/api/rounds/today?date=${encodeURIComponent(date)}`),
  round: id => call('GET', `/api/rounds/${id}`),
  createRound: round => call('POST', '/api/rounds', round),
  deleteRound: id => call('DELETE', `/api/rounds/${id}`),
  guesses: roundId => call('GET', `/api/rounds/${roundId}/guesses`),
  guess: (roundId, pose) => call('POST', `/api/rounds/${roundId}/guesses`, pose),
};
