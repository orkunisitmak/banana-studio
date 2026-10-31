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
 await sql.unsafe(fs.readFileSync(new URL('../supabase/tests/media-bucket-limits.sql',import.meta.url),'utf8'));
 // Reapply the actual migration to legacy bucket metadata in a rollback-only
 // transaction. Existing objects and unrelated buckets must remain untouched.
 const mediaLimits = fs.readFileSync(new URL('../supabase/migrations/20261030140000_media_bucket_upload_limits.sql',import.meta.url),'utf8');
 await sql.unsafe('BEGIN');
 try {
  await sql.unsafe(`
   INSERT INTO storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
    VALUES('unrelated-test','unrelated-test',true,1234,ARRAY['application/pdf']);
   INSERT INTO storage.objects(bucket_id,name,metadata)
    VALUES('media','legacy-upload.bin','{"size":600000000,"mimetype":"application/octet-stream"}');
  `);
  for (const mimeTypes of [null, []]) {
   await sql`UPDATE storage.buckets SET file_size_limit=NULL,allowed_mime_types=${mimeTypes} WHERE id='media'`;
   await sql.unsafe(mediaLimits);
   await sql.unsafe(fs.readFileSync(new URL('../supabase/tests/media-bucket-limits.sql',import.meta.url),'utf8'));
  }
  await sql.unsafe(`UPDATE storage.buckets SET file_size_limit=1048576,allowed_mime_types=ARRAY['image/png'] WHERE id='media'`);
  await sql.unsafe(mediaLimits);
  await sql.unsafe(mediaLimits); // Applying twice must not broaden custom limits.
  await sql.unsafe(`DO $$ BEGIN
   IF NOT EXISTS(SELECT FROM storage.buckets WHERE id='media' AND file_size_limit=1048576 AND allowed_mime_types=ARRAY['image/png'])
    THEN RAISE EXCEPTION 'Custom bucket restrictions were relaxed';END IF;
   IF NOT EXISTS(SELECT FROM storage.buckets WHERE id='unrelated-test' AND public AND file_size_limit=1234 AND allowed_mime_types=ARRAY['application/pdf'])
    THEN RAISE EXCEPTION 'Unrelated bucket was modified';END IF;
   IF NOT EXISTS(SELECT FROM storage.objects WHERE bucket_id='media' AND name='legacy-upload.bin' AND metadata='{"size":600000000,"mimetype":"application/octet-stream"}'::jsonb)
    THEN RAISE EXCEPTION 'An existing object was modified';END IF;
  END $$`);
  await sql`UPDATE storage.buckets SET file_size_limit=1073741824 WHERE id='media'`;
  await sql.unsafe(mediaLimits);
  const [bucket] = await sql`SELECT file_size_limit FROM storage.buckets WHERE id='media'`;
  if (Number(bucket.file_size_limit) !== 524288000) throw new Error('An oversized legacy bucket cap was not reduced');
 } finally { await sql.unsafe('ROLLBACK'); }
 console.log('Media bucket fresh-install, legacy-upgrade and custom-limit preservation assertions passed.');
 console.log('Fresh schema installed and ownership, access-list, private-storage and preference assertions passed.');
} catch(error) {console.error('Isolated database verification failed:',error.message);process.exitCode=1;}
finally {if(sql)await sql.end();if(started)execFileSync(path.join(bin,'pg_ctl'),['-D',path.join(directory,'data'),'-m','fast','-w','stop'],{stdio:'pipe'});fs.rmSync(directory,{recursive:true,force:true});}
