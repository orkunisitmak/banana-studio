import test from 'node:test';
import assert from 'node:assert/strict';
import { comfyBaseUrl, comfyCanvas, comfyEditCrop, comfyFailureMessage, comfyFlux3Graph, comfyGraph, comfyPrompt, COMPILER_SECTIONS } from '../api/_lib/comfyuiImage.ts';
import { MODEL_ROUTES, resolveProvider, startingImageModel } from '../src/lib/providers.ts';

test('local canvas keeps the requested shape at the resolution budget in multiples of 16',()=>{
  assert.deepEqual(comfyCanvas('1024x1024','1:1','1K'),[1024,1024]);
  for(const [size,ratio,resolution] of [['auto','16:9','1K'],['1536x1024','3:4','2K'],['3000x2000','1:1','4K'],[undefined,'9:16','1K']]){
    const [width,height]=comfyCanvas(size,ratio,resolution);
    assert.equal(width%16,0);assert.equal(height%16,0);
    const megapixels=width*height/1024/1024,budget={'1K':1,'2K':2,'4K':4}[resolution];
    assert.ok(Math.abs(megapixels-budget)/budget<0.05,`${size} ${ratio} ${resolution} -> ${width}x${height}`);
  }
  const [width,height]=comfyCanvas('3000x2000','1:1','1K');assert.ok(Math.abs(width/height-1.5)<0.02);
});

test('references chain into both conditionings and every link targets an existing node',()=>{
  const plain=comfyGraph('a banana',[1024,768],[],7),edit=comfyGraph('make it blue',[1024,1024],['banana-studio/a.png','banana-studio/b.png'],7);
  assert.deepEqual(plain.guider.inputs.positive,['text',0]);assert.deepEqual(plain.guider.inputs.negative,['empty',0]);
  assert.deepEqual(edit.guider.inputs.positive,['positive1',0]);assert.deepEqual(edit.guider.inputs.negative,['negative1',0]);
  assert.deepEqual(edit.positive1.inputs.conditioning,['positive0',0]);assert.deepEqual(edit.negative0.inputs.conditioning,['empty',0]);
  assert.equal(edit.load1.inputs.image,'banana-studio/b.png');
  assert.deepEqual([plain.latent.inputs.width,plain.latent.inputs.height,plain.sigmas.inputs.steps,plain.guider.inputs.cfg],[1024,768,4,1]);
  for(const graph of [plain,edit])for(const node of Object.values(graph))for(const value of Object.values(node.inputs)){
    if(Array.isArray(value))assert.ok(Object.hasOwn(graph,value[0]),`missing ${value[0]}`);
  }
});

test('an edit area crop keeps the selection with context inside the source canvas',()=>{
  assert.deepEqual(comfyEditCrop({left:634,top:634,width:339,height:360},[1024,1024]),{left:454,top:454,width:570,height:570});
  // A small selection still gets a quarter of the canvas as context.
  assert.deepEqual(comfyEditCrop({left:500,top:500,width:20,height:20},[1024,1024]),{left:372,top:372,width:276,height:276});
  for(const [bounds,size] of [[{left:0,top:0,width:1536,height:1024},[1536,1024]],[{left:30,top:700,width:384,height:256},[1536,1024]],[{left:3800,top:10,width:40,height:2000},[3840,2160]]]){
    const crop=comfyEditCrop(bounds,size);
    assert.ok(crop.left>=0&&crop.top>=0&&crop.left+crop.width<=size[0]&&crop.top+crop.height<=size[1],JSON.stringify(crop));
    assert.ok(crop.left<=bounds.left&&crop.top<=bounds.top&&crop.left+crop.width>=bounds.left+bounds.width&&crop.top+crop.height>=bounds.top+bounds.height,JSON.stringify(crop));
  }
});

test('an edit area inpaints a crop of the source and pastes it back at source size',()=>{
  const crop={left:454,top:454,width:570,height:570};
  const graph=comfyGraph('add a snowman',[1024,1024],['banana-studio/donor.png','banana-studio/source.png'],7,{source:1,mask:'banana-studio/mask.png',crop,grow:9});
  // The source crop is both the reference and the starting latent; the donor reference is untouched.
  assert.deepEqual(graph.crop.inputs,{image:['load1',0],width:570,height:570,x:454,y:454});
  assert.deepEqual(graph.scale1.inputs,{image:['crop',0],upscale_method:'lanczos',width:1024,height:1024,crop:'disabled'});
  assert.equal(graph.scale0.class_type,'ImageScaleToTotalPixels');
  assert.deepEqual(graph.guider.inputs.positive,['positive1',0]);assert.deepEqual(graph.positive1.inputs.latent,['encode1',0]);
  assert.deepEqual([graph.mask.class_type,graph.mask.inputs.image,graph.mask.inputs.channel],['LoadImageMask','banana-studio/mask.png','red']);
  assert.deepEqual(graph.cropMask.inputs,{mask:['mask',0],x:454,y:454,width:570,height:570});
  assert.deepEqual(graph.area.inputs.expand,9);
  assert.deepEqual([graph.latent.class_type,graph.latent.inputs.samples,graph.latent.inputs.mask],['SetLatentNoiseMask',['encode1',0],['area',0]]);
  assert.deepEqual(graph.sample.inputs.latent_image,['latent',0]);
  assert.deepEqual([graph.sigmas.inputs.width,graph.sigmas.inputs.height],[1024,1024]);
  assert.deepEqual(graph.restore.inputs,{image:['decode',0],upscale_method:'lanczos',width:570,height:570,crop:'disabled'});
  assert.deepEqual(graph.paste.inputs,{destination:['load1',0],source:['restore',0],x:454,y:454,resize_source:false,mask:['area',0]});
  assert.deepEqual(graph.output.inputs.images,['paste',0]);
  for(const node of Object.values(graph))for(const value of Object.values(node.inputs))if(Array.isArray(value))assert.ok(Object.hasOwn(graph,value[0]),`missing ${value[0]}`);
  // Without an edit area the graph stays text-to-image or reference editing on an empty latent.
  const plain=comfyGraph('make it blue',[1024,1024],['banana-studio/source.png'],7);
  assert.equal(plain.latent.class_type,'EmptyFlux2LatentImage');assert.deepEqual(plain.output.inputs.images,['decode',0]);
  for(const key of ['crop','mask','cropMask','area','restore','paste'])assert.ok(!Object.hasOwn(plain,key),key);
});

test('the ComfyUI address is a plain server-owned http(s) origin',()=>{
  assert.equal(comfyBaseUrl('http://127.0.0.1:8188/'),'http://127.0.0.1:8188');
  for(const value of ['file:///etc/passwd','http://user:pass@127.0.0.1:8188','http://127.0.0.1:8188/?x=1','not a url'])assert.throws(()=>comfyBaseUrl(value));
});

test('the local model is served only by ComfyUI and explains its setup',()=>{
  assert.deepEqual(MODEL_ROUTES['flux2-klein-local'],['comfyui']);
  assert.equal(resolveProvider('flux2-klein-local','auto',{comfyui:true,fal:true}),'comfyui');
  assert.throws(()=>resolveProvider('flux2-klein-local','auto',{fal:true}),/COMFYUI_URL/);
  assert.throws(()=>resolveProvider('gemini-3-pro-image-preview','comfyui',{comfyui:true}));
});

test('section labels reach ComfyUI as plain text, never as words to paint',()=>{
  assert.equal(comfyPrompt('CREATIVE BRIEF\nA poster titled "SUMMER MUSIC FESTIVAL 2026"'),'A poster titled "SUMMER MUSIC FESTIVAL 2026"');
  // An edit area is enforced by the mask; preservation prose is not sent.
  assert.equal(comfyPrompt('REFERENCE ROLES (attachment order)\nImage 1: style\n\nREQUESTED EDIT\nMake it blue\n\nSOURCE PRESERVATION\nKeep the face'),'Make it blue');
  // Quoted copy, inline capitals and a lone capitalised line are the user's words.
  for(const prompt of ['A neon sign that says "OPEN"','Make the TEXT bigger','OPEN'])assert.equal(comfyPrompt(prompt),prompt);
  // Capitalised lines inside the brief are copy to render, not section labels.
  assert.equal(comfyPrompt('CREATIVE BRIEF\nPoster with text:\nSUMMER SALE\n50% OFF'),'Poster with text:\nSUMMER SALE\n50% OFF');
  assert.equal(comfyPrompt('REQUESTED EDIT\nReplace the sign with:\nGRAND OPENING (TODAY)\n\nSOURCE PRESERVATION\nKeep the face'),'Replace the sign with:\nGRAND OPENING (TODAY)');
});

test('a Brainstorm concept keeps its source brief but not the camera-gaze policy block',async()=>{
  const {build}=await import('esbuild');const {fileURLToPath}=await import('node:url');
  const out=await build({entryPoints:[fileURLToPath(new URL('../src/lib/youtube/youtubeCameraGaze.ts',import.meta.url))],bundle:true,write:false,format:'esm',platform:'node'});
  const {YOUTUBE_CAMERA_GAZE_RULE}=await import('data:text/javascript;base64,'+Buffer.from(out.outputFiles[0].text).toString('base64'));
  const local=comfyPrompt(`CREATIVE BRIEF\nHost laughing at a giant cake\n\n${YOUTUBE_CAMERA_GAZE_RULE}\n\nSOURCE BRIEF — REQUIRED CONSTRAINTS\nText: "BAKE OFF"`);
  assert.ok(local.startsWith('Host laughing at a giant cake\n'),local);
  assert.ok(local.endsWith('\nSOURCE BRIEF — REQUIRED CONSTRAINTS\nText: "BAKE OFF"'),local);
  assert.ok(!/CAMERA GAZE|eye contact/.test(local),local);
});

test('every local section label is a heading the shared prompt compiler emits',async()=>{
  const {readFile,readdir}=await import('node:fs/promises');
  let source='';
  for(const dir of ['src/lib/images','src/lib/references','src/lib/youtube'])for(const name of await readdir(dir))if(name.endsWith('.ts'))source+=(await readFile(`${dir}/${name}`,'utf8')).replace(/\r\n/g,'\n')+'\n';
  // A heading is a whole line of a template or a joined string: 'LOCAL IMAGE EDIT', `EDIT AREAS\n…`.
  for(const label of COMPILER_SECTIONS)assert.ok(source.includes(`'${label}'`)||['\n','\\n',"'",'`'].some(before=>['\n','\\n',' ('].some(after=>source.includes(before+label+after))),label);
});

test('local failures explain the ComfyUI fix and never mention provider billing',()=>{
  assert.match(comfyFailureMessage(new TypeError('fetch failed')),/could not reach ComfyUI.*COMFYUI_URL/);
  assert.match(comfyFailureMessage(Object.assign(new Error('x'),{name:'TimeoutError'})),/time limit/);
  assert.equal(comfyFailureMessage(new Error('ComfyUI returned no image.')),'ComfyUI returned no image.');
  for(const error of [new TypeError('fetch failed'),new Error('boom'),null])assert.match(comfyFailureMessage(error),/nothing was charged/);
});

test('FLUX 3 Klein follows its distilled template and shares the edit-area paste-back',()=>{
  const links=graph=>{for(const node of Object.values(graph))for(const value of Object.values(node.inputs))if(Array.isArray(value))assert.ok(Object.hasOwn(graph,value[0]),`missing ${value[0]}`);};
  const plain=comfyFlux3Graph('a red fox',[1024,768],[],5);
  assert.deepEqual([plain.clip.inputs.type,plain.sample.class_type,plain.sample.inputs.steps,plain.sample.inputs.cfg,plain.sample.inputs.sampler_name],['flux3','KSampler',16,1,'euler']);
  assert.deepEqual([plain.sample.inputs.positive,plain.sample.inputs.negative],[['text',0],['empty',0]]);
  assert.deepEqual([plain.latent.class_type,plain.latent.inputs.width,plain.latent.inputs.height],['EmptyFlux2LatentImage',1024,768]);
  assert.ok(!Object.hasOwn(plain,'refs'));links(plain);
  const refs=comfyFlux3Graph('mix them',[1024,1024],['banana-studio/a.png','banana-studio/b.png','banana-studio/c.png'],5);
  assert.deepEqual([refs.refs.class_type,refs.refs.inputs['images.image2'],refs.refs.inputs['resolution.megapixels']],['ReferenceMultiLatent',['load2',0],1]);
  assert.deepEqual([refs.sample.inputs.positive,refs.sample.inputs.negative],[['refs',0],['refs',1]]);links(refs);
  const crop={left:454,top:454,width:570,height:570};
  const edit=comfyFlux3Graph('add a snowman',[1024,1024],['banana-studio/donor.png','banana-studio/source.png'],5,{source:1,mask:'banana-studio/mask.png',crop,grow:9});
  // The scaled source crop is both a reference and the masked starting latent.
  assert.deepEqual([edit.refs.inputs['images.image1'],edit.refs.inputs['images.image0']],[['source',0],['load0',0]]);
  assert.deepEqual(edit.source.inputs.image,['crop',0]);assert.deepEqual(edit.latent.inputs,{samples:['encode',0],mask:['area',0]});
  assert.deepEqual(edit.paste.inputs.destination,['load1',0]);assert.deepEqual(edit.output.inputs.images,['paste',0]);links(edit);
});

test('a draft without a usable key starts on FLUX 3 Klein when ComfyUI is configured',()=>{
  assert.equal(startingImageModel('gpt-image-2.5-sunburst',{comfyui:true}),'flux3-klein-local');
  // A configured provider, a missing ComfyUI or an already local choice is left alone.
  assert.equal(startingImageModel('gpt-image-2.5-sunburst',{openai:true,comfyui:true}),'gpt-image-2.5-sunburst');
  assert.equal(startingImageModel('gemini-3-pro-image-preview',{}),'gemini-3-pro-image-preview');
  assert.equal(startingImageModel('flux2-klein-local',{comfyui:true}),'flux2-klein-local');
});

test('a YouTube cover with a saved person reaches ComfyUI as the brief plus who the photos show',async()=>{
  const {build}=await import('esbuild');const {fileURLToPath}=await import('node:url');
  const out=await build({entryPoints:[fileURLToPath(new URL('../src/lib/images/imagePrompting.ts',import.meta.url))],bundle:true,write:false,format:'esm',platform:'node'});
  const {prepareSunburstGeneration}=await import('data:text/javascript;base64,'+Buffer.from(out.outputFiles[0].text).toString('base64'));
  const refs=Array.from({length:6},(_,i)=>({id:'p'+i,data:'https://x/'+i+'.png',mimeType:'image/png',personId:1,personName:'Zehra'}));
  const brief='YouTube thumbnail, 16:9: the woman @Zehra trying a bold red lipstick, big text "İLK KEZ"';
  const compiled=prepareSunburstGeneration(brief,refs,{imageModel:'flux3-klein-local',aspectRatio:'16:9',resolution:'1K'}).prompt;
  assert.ok(compiled.length>2000&&/WARDROBE/.test(compiled),'the hosted prompt still carries its policy text');
  const local=comfyPrompt(compiled);
  assert.equal(local,'Reference photos: image 1, image 2, image 3, image 4, image 5, image 6 show Zehra. Keep each person\'s exact face, hair and identity.\n\nYouTube thumbnail, 16:9: the woman Zehra trying a bold red lipstick, big text "İLK KEZ"');
  for(const leak of ['WARDROBE','CONCEPT','REFERENCE ROLES','MEDIUM','@'])assert.ok(!local.includes(leak),leak);
});
