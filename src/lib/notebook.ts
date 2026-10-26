import type { StudyNote } from "./learning-types";
import { durableNote, isStudyNote } from "./learning";

const DATABASE = "vidsnap-notebook";
const STORE = "notes";

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") { reject(new Error("当前浏览器不支持本地笔记")); return; }
    const request = indexedDB.open(DATABASE, 1);
    request.onupgradeneeded = () => { request.result.createObjectStore(STORE, { keyPath: "id" }); };
    request.onsuccess = () => { request.result.onversionchange = () => request.result.close(); resolve(request.result); };
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error("笔记库正在被其他页面使用，请关闭旧页面后重试"));
  });
}

async function transaction<T>(mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = database.transaction(STORE, mode);
    const request = action(tx.objectStore(STORE));
    tx.oncomplete = () => { database.close(); resolve(request.result); };
    tx.onabort = () => { database.close(); reject(tx.error ?? new Error("本地保存失败")); };
    tx.onerror = () => { /* 等待 abort，不能将请求成功误当作事务提交。 */ };
  });
}

export async function listNotes(): Promise<StudyNote[]> {
  const values: unknown[] = await transaction("readonly", store => store.getAll());
  if (values.some(value => !isStudyNote(value))) throw new Error("笔记格式暂不兼容，已保留原始数据");
  return values.filter(isStudyNote).sort((a, b) => b.lastViewedAt - a.lastViewedAt);
}

export async function saveNote(note: StudyNote): Promise<void> {
  await transaction("readwrite", store => store.put(durableNote(note)));
}

export async function deleteNote(id: string): Promise<void> {
  await transaction("readwrite", store => store.delete(id));
}
