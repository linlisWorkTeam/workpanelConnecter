/**
 * In-memory WP credentials for a pet after WorkPet login.
 * Not persisted; relay restart requires login again.
 */

const byPetId = new Map();

export function setSessionWpAuth(petId, auth) {
  if (!petId) return;
  byPetId.set(petId, {
    username: String(auth?.username || ''),
    password: String(auth?.password || ''),
    wpUserId: auth?.wpUserId || null,
  });
}

export function getSessionWpAuth(petId) {
  if (!petId) return null;
  return byPetId.get(petId) || null;
}

export function clearSessionWpAuth(petId) {
  if (petId) byPetId.delete(petId);
  else byPetId.clear();
}
