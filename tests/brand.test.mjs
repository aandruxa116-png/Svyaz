import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {AVATAR_COLORS} from '../data.js';
function luminance(hex){const rgb=hex.match(/[a-f\d]{2}/gi).map(c=>parseInt(c,16)/255).map(c=>c<=.04045?c/12.92:((c+.055)/1.055)**2.4);return .2126*rgb[0]+.7152*rgb[1]+.0722*rgb[2];}
function ratio(a,b){const x=luminance(a),y=luminance(b);return (Math.max(x,y)+.05)/(Math.min(x,y)+.05);}
test('shared dark/light palette meets 4.5:1 for normal text and active buttons',async()=>{
 for(const color of AVATAR_COLORS)assert.ok(ratio('ffffff',color.slice(1))>=4.5);
 const css=await readFile('brand.css','utf8');
 for(const selector of [':root','body.light']){
  const block=css.slice(css.indexOf(selector+'{')).split('}')[0];
  const colors=Object.fromEntries([...block.matchAll(/--([a-z0-9-]+):#([a-f\d]{6})/gi)].map(m=>[m[1],m[2]]));
  for(const [front,back] of [['text','bg'],['text','surface'],['muted','surface'],['muted','surface2'],['accent','surface'],['text','incoming'],['text','bubble'],['timestamp','bubble']])
   assert.ok(ratio(colors[front],colors[back])>=4.5,`${selector}: ${front}/${back}`);
  assert.ok(ratio('ffffff',colors.accent2)>=4.5,`${selector}: button label`);
 }
});
test('web icons have actual dimensions and installation stays within the existing Pages path',async()=>{
 for(const [file,size] of [['favicon-32.png',32],['apple-touch-icon.png',180],['icon-192.png',192],['icon-512.png',512]]){
  const bytes=await readFile('assets/brand/'+file);assert.equal(bytes.readUInt32BE(16),size);assert.equal(bytes.readUInt32BE(20),size);
 }
 const manifest=JSON.parse(await readFile('manifest.webmanifest','utf8'));
 assert.equal(manifest.scope,'./');assert.equal(manifest.start_url,'./');assert.ok(manifest.icons.every(icon=>!icon.src.startsWith('/')));
});
