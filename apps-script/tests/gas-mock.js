/* A small in-memory stand-in for the Google Apps Script services Code.gs uses */
const crypto=require('crypto'),vm=require('vm'),fs=require('fs');
function install(){
  const sheets={};const mails=[];const props={};const cache={};let quotaCalls=0;
  const mkSheet=(name)=>{const data=[[]];let frozen=0;const sh={
    _data:data,getName:()=>name,getMaxRows:()=>1000,getLastRow:()=>data.length===1&&data[0].length===0?0:data.length,
    setFrozenRows:n=>{frozen=n},
    getRange(r,c,nr=1,nc=1){return{setValues(v){for(let i=0;i<nr;i++){data[r-1+i]=data[r-1+i]||[];for(let j=0;j<nc;j++)data[r-1+i][c-1+j]=v[i][j]}return this},
      getValues(){const o=[];for(let i=0;i<nr;i++){const row=[];for(let j=0;j<nc;j++){const x=(data[r-1+i]||[])[c-1+j];row.push(x===undefined?'':x)}o.push(row)}return o},setNumberFormat(){return this}}},
    deleteRow(n){data.splice(n-1,1)}};return sh};
  const ss={getSheetByName:n=>sheets[n]||null,insertSheet:n=>(sheets[n]=mkSheet(n))};
  const g=global;
  g.SpreadsheetApp={getActiveSpreadsheet:()=>ss};
  const bytes=b=>[...b].map(x=>x>127?x-256:x);
  g.Utilities={getUuid:()=>crypto.randomUUID(),
    computeHmacSha256Signature:(v,k)=>bytes(crypto.createHmac('sha256',String(k)).update(String(v)).digest()),
    computeDigest:(alg,s)=>bytes(crypto.createHash('sha256').update(String(s)).digest()),DigestAlgorithm:{SHA_256:'sha256'},Charset:{UTF_8:'utf8'}};
  g.LockService={getScriptLock:()=>({waitLock(){},releaseLock(){}})};
  g.CacheService={getScriptCache:()=>({get:k=>cache[k]===undefined?null:cache[k],put:(k,v)=>{cache[k]=v}})};
  g.PropertiesService={getScriptProperties:()=>({getProperty:k=>props[k]===undefined?null:props[k],setProperty:(k,v)=>{props[k]=v}})};
  g.MailApp={sendEmail:m=>mails.push(m),getRemainingDailyQuota:()=>100};
  g.ContentService={MimeType:{JSON:'json'},createTextOutput:s=>({getContent:()=>s,setMimeType(){return this}})};
  return {sheets,mails,props,cache};
}
function loadBackend(){const env=install();vm.runInThisContext(fs.readFileSync(__dirname+'/../Code.gs','utf8'),{filename:'Code.gs'});return env}
/* make a browser-like client: runs sheets-client.js against the mock server */
function makeClient(href='https://demo.amortree.com/Coupledger/',seed){
  const store=new Map();const timers=new Set();const stats={requests:0};if(seed)Object.keys(seed).forEach(k=>store.set(k,seed[k]));
  const ctx={console,localStorage:{getItem:k=>store.has(k)?store.get(k):null,setItem:(k,v)=>store.set(k,String(v)),removeItem:k=>store.delete(k)},
    sessionStorage:{getItem:()=>null,setItem(){}},location:new URL(href),history:{replaceState(a,b,u){ctx.location=new URL(u,ctx.location.href)}},document:{hidden:false},
    URL,AbortController,setTimeout:(f,ms)=>{const t=setTimeout(f,ms);timers.add(t);return t},clearTimeout,setInterval:(f,ms)=>{const t=setInterval(f,ms);timers.add(t);return t},clearInterval,
    CL_POLL_MS:60,fetch:async(url,opt)=>{stats.requests++;const out=global.doPost({postData:{contents:opt.body}});return{text:async()=>out.getContent()}}};
  let code=fs.readFileSync(__dirname+'/../sheets-client.js','utf8').replace('PASTE_YOUR_APPS_SCRIPT_WEB_APP_URL_HERE','https://script.google.com/macros/s/TEST/exec');
  vm.createContext(ctx);vm.runInContext(code+';this.sb=sb;',ctx);
  return {sb:ctx.sb,store,stats,stop:()=>timers.forEach(t=>{clearTimeout(t);clearInterval(t)})};
}
module.exports={loadBackend,makeClient};
