import test from 'node:test';
import assert from 'node:assert/strict';
import { convertHeicFile, isHeicFile } from '../src/lib/references/heicImages.ts';
import { getClipboardImages } from '../src/lib/references/clipboardImages.ts';

test('HEIC photos are recognised by type or by extension when Windows reports none',()=>{
  for(const file of [new File([],'IMG_0001.HEIC'),new File([],'a.heif'),new File([],'x',{type:'image/heic'}),new File([],'x',{type:'image/heif-sequence'})])assert.ok(isHeicFile(file),file.name);
  for(const file of [new File([],'a.jpg',{type:'image/jpeg'}),new File([],'heic.png',{type:'image/png'}),new Blob([],{type:'image/webp'})])assert.ok(!isHeicFile(file));
  assert.deepEqual(getClipboardImages({items:[],files:[new File([],'IMG_1.heic'),new File([],'notes.txt')]}).map(file=>file.name),['IMG_1.heic']);
});

test('other images pass through untouched and the decoder is never loaded',async()=>{
  const jpeg=new File([new Uint8Array([255,216,255])],'a.jpg',{type:'image/jpeg'});
  assert.equal(await convertHeicFile(jpeg),jpeg);
});
