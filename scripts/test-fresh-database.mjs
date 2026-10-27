import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import postgres from 'postgres';
const bin=process.env.PG_TEST_BIN;
if(!bin)throw new Error('Set PG_TEST_BIN to PostgreSQL 15+ binaries (initdb, pg_ctl). This test creates an isolated temporary database and never connects to a configured workspace.');
const directory=fs.mkdtempSync(path.join(os.tmpdir(),'banana-fresh-db-'));
let started=false,sql;
try {
 execFileSync(path.join(bin,'initdb'),['-D',path.join(directory,'data'),'-A','trust','-U','postgres','--no-locale'],{stdio:'pipe'});
 execFileSync(path.join(bin,'pg_ctl'),['-D',path.join(directory,'data'),'-l',path.join(directory,'server.log'),'-o',`-F -c listen_addresses='' -k ${directory}`,'-w','start'],{stdio:'pipe'});started=true;
 sql=postgres({host:directory,username:'postgres',database:'postgres',max:1,onnotice:()=>{}});
 await sql.unsafe(fs.readFileSync(new URL('../supabase/tests/platform-shim.sql',import.meta.url),'utf8'));
 const migrations=fs.readdirSync(new URL('../supabase/migrations',import.meta.url)).filter(f=>f.endsWith('.sql')).sort();
 for(const migration of migrations)await sql.unsafe(fs.readFileSync(new URL('../supabase/migrations/'+migration,import.meta.url),'utf8'));
 await sql.unsafe(fs.readFileSync(new URL('../supabase/tests/fresh-install.sql',import.meta.url),'utf8'));
 await sql.unsafe(fs.readFileSync(new URL('../supabase/tests/provider-ledger.sql',import.meta.url),'utf8'));
 console.log('Fresh schema installed and ownership, access-list, private-storage, preference and provider ledger assertions passed.');
} catch(error) {console.error('Isolated database verification failed:',error.message);process.exitCode=1;}
finally {if(sql)await sql.end();if(started)execFileSync(path.join(bin,'pg_ctl'),['-D',path.join(directory,'data'),'-m','fast','-w','stop'],{stdio:'pipe'});fs.rmSync(directory,{recursive:true,force:true});}
