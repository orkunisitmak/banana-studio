import {validateWorkspaceConfig} from '../../src/lib/config/runtimeConfig';
async function bootstrap(){
const response=await fetch('/api/workspace-config',{credentials:'same-origin'});
if(!response.ok)throw new Error('Synthetic workspace bootstrap required');
window.__BANANA_STUDIO_CONFIG__=Object.freeze(validateWorkspaceConfig(await response.json()));
await import('./alpha-acceptance.fixture');

}
void bootstrap();
