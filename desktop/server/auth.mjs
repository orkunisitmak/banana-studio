import { getWorkspace, LOCAL_AUTH } from './context.mjs';
export const createServiceRoleClient = () => getWorkspace().client(true);
export const createUserScopedClient = req => { if(!req[LOCAL_AUTH])throw new Error('Native session required.');return getWorkspace().client(true); };
export async function requireUser(req,res) { if(!req[LOCAL_AUTH]){res.status(401).json({error:'Open this workspace in Banana Studio.'});return null;}return getWorkspace().user; }
export const requireAdmin = requireUser;
export const applyCors = () => true;
