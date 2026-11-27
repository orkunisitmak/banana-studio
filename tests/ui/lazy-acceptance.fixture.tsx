import React,{useState} from 'react';
import {createRoot} from 'react-dom/client';
import '../../src/styles/index.css';
import {DeferredAdminPanel} from '../../src/components/DeferredAdminPanel';
function Fixture(){const [open,setOpen]=useState(false);return <main><h1>Actual deferred admin / temporary local workspace</h1><p>No accounts, providers or mock imports.</p><button onClick={()=>setOpen(true)}>Open admin acceptance</button><DeferredAdminPanel isOpen={open} onClose={()=>setOpen(false)} onViewUserGallery={()=>{}}/></main>;}
createRoot(document.getElementById('root')!).render(<Fixture/>);
