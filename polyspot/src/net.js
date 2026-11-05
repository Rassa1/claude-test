import os from 'node:os';

/** IPv4 addresses other devices on the network can reach, home/campus Wi-Fi ranges first. */
export function lanAddresses() {
  const isPrivate = ip => /^(192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/.test(ip);
  const ips = Object.values(os.networkInterfaces()).flat()
    .filter(a => a && (a.family === 'IPv4' || a.family === 4) && !a.internal)
    .map(a => a.address);
  return [...new Set(ips)].sort((a, b) => isPrivate(b) - isPrivate(a));
}
