import {createServer} from 'node:http';
import {Readable} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import worker from '../dist/server/index.js';
import { localOwner, openLocalStore } from '../src/local-store.mjs';
const folder=process.env.GUIXU_DATA_DIR||'.local/data';
const env=openLocalStore(folder);
const port=Number(process.argv[2]??4173);
createServer(async(req,res)=>{
  try{
    const headers=new Headers(req.headers);
    headers.set('oai-authenticated-user-id',localOwner);
    const request=new Request('http://127.0.0.1:'+port+req.url,{method:req.method,headers,...(!['GET','HEAD'].includes(req.method)?{body:Readable.toWeb(req),duplex:'half'}:{})});
    const response=await worker.fetch(request,env);
    res.writeHead(response.status,Object.fromEntries(response.headers));
    if(response.body)await pipeline(Readable.fromWeb(response.body),res);else res.end();
  }catch(e){console.error(e);if(!res.headersSent)res.writeHead(500);res.end();}
}).listen(port,'127.0.0.1',()=>console.log('Local: http://127.0.0.1:'+port));
