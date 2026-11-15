import {test} from 'node:test';
import assert from 'node:assert/strict';
import {NOTEBOOK_KEY, readNotebook, saveNotebook, readPreviousNotebook} from '../store.js';

function memoryStorage(initial={}) {
  const values=new Map(Object.entries(initial));
  return {values,getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,String(value)),removeItem:key=>values.delete(key)};
}
test('a new notebook is empty and leaves previous-version learning data intact',()=>{
  const storage=memoryStorage({'moxi-learning-v1':'old learning data','moxi-api-endpoint':'legacy configuration'});
  globalThis.localStorage=storage;
  assert.deepEqual(readNotebook(),{data:{notes:[],overrides:[],aliases:[]},error:null});
  const data={notes:[{id:'n1',content:'第一行\n第二行：橋、桥。'}],overrides:[],aliases:[]};
  assert.equal(saveNotebook(data).saved,true);
  assert.deepEqual(readNotebook().data,data);
  assert.equal(storage.values.get('moxi-learning-v1'),'old learning data');
  assert.equal(storage.values.get('moxi-api-endpoint'),'legacy configuration');
});
test('each successful replacement keeps the preceding notebook available for recovery',()=>{
  globalThis.localStorage=memoryStorage();
  const first={notes:[{id:'a',content:'先前的笔记'}],overrides:[],aliases:[]};
  const second={notes:[{id:'b',content:'新的笔记'}],overrides:[],aliases:[]};
  assert.equal(saveNotebook(first).saved,true);
  assert.equal(readPreviousNotebook().data,null);
  assert.equal(saveNotebook(second).saved,true);
  assert.deepEqual(readNotebook().data,second);
  assert.deepEqual(readPreviousNotebook().data,first);
});
test('storage denial is reported and never presented as a successful save',()=>{
  const storage=memoryStorage({[NOTEBOOK_KEY]:JSON.stringify({notes:[{id:'old'}],overrides:[],aliases:[]})});
  storage.setItem=()=>{throw new Error('QuotaExceededError');};
  globalThis.localStorage=storage;
  const result=saveNotebook({notes:[{id:'new'}],overrides:[],aliases:[]});
  assert.equal(result.saved,false);
  assert.match(result.error,/Quota/);
  assert.equal(readNotebook().data.notes[0].id,'old');
});
test('corrupted stored data is reported without deleting the recoverable raw value',()=>{
  const raw='{ damaged JSON';
  const storage=memoryStorage({[NOTEBOOK_KEY]:raw});
  globalThis.localStorage=storage;
  assert.ok(readNotebook().error);
  assert.equal(storage.values.get(NOTEBOOK_KEY),raw);
});
test('private-mode storage read failure is recoverable as an empty unsaved session',()=>{
  globalThis.localStorage={getItem(){throw Error('storage blocked');},setItem(){throw Error('storage blocked');}};
  assert.match(readNotebook().error,/storage blocked/);
  assert.deepEqual(readNotebook().data,{notes:[],overrides:[],aliases:[]});
  assert.equal(saveNotebook({notes:[],overrides:[],aliases:[]}).saved,false);
});
