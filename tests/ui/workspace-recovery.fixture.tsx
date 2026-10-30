import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { chooseAccount } from './browser-auth';
window.__BANANA_STUDIO_CONFIG__ = { mode: 'local', userId: '00000000-0000-0000-0000-000000000001', sessionId: '00000000-0000-0000-0000-000000000002' };
// Block provider and account network traffic; Vite module loading is unaffected.
window.fetch = async () => { throw new Error('Synthetic fixture blocks application network requests.'); };
const [{ AuthBoundary }, { getImageById }] = await Promise.all([import('../../src/components/AuthBoundary'), import('../../src/services/storageService')]);
const synthetic = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"><rect width="20" height="20" fill="green"/></svg>');
const read = <T,>(req: IDBRequest<T>) => new Promise<T>((resolve, reject) => { req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error); });
function Workspace({ userId, signOut }: { userId: string; signOut: () => Promise<void> }) {
  const [image, setImage] = useState<string>();
  useEffect(() => { void getImageById('unsynced').then(media => setImage(media?.url)); }, [userId]);
  const save = async () => {
    const opening = indexedDB.open(`NanoGenDB:${userId}`, 5);
    opening.onupgradeneeded = () => { for (const name of ['images','templates','folders','referenceGallery']) opening.result.createObjectStore(name, { keyPath: 'id' }); };
    const db = await read(opening);
    await new Promise<void>((resolve, reject) => { const tx = db.transaction('images','readwrite'); tx.objectStore('images').put({ id:'unsynced', url:synthetic, syncStatus:'local-only', createdAt:1 }); tx.oncomplete=()=>resolve(); tx.onerror=()=>reject(tx.error); });
    db.close(); setImage(synthetic);
  };
  return <section><h2>Workspace {userId}</h2><button onClick={() => void save()}>Save offline creation</button><button onClick={() => void signOut()}>Sign out</button>{image ? <img alt="Recovered offline creation" src={image} /> : <p>No offline creation</p>}</section>;
}
function Fixture() { return <><h1>Workspace recovery regression</h1><button onClick={() => void chooseAccount('account-a')}>Choose account A</button><button onClick={() => void chooseAccount('account-b')}>Choose account B</button><AuthBoundary>{({ userId }, signOut) => <Workspace key={userId} userId={userId} signOut={signOut} />}</AuthBoundary></>; }
createRoot(document.getElementById('root')!).render(<React.StrictMode><Fixture /></React.StrictMode>);
