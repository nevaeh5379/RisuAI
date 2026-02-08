import { language } from "src/lang"
import { alertInput } from "../alert"
let auth:string = null
let authChecked = false

// IndexedDB cache for NodeStorage items
const NODE_STORAGE_DB_NAME = 'risuai-node-storage-cache';
const NODE_STORAGE_DB_VERSION = 1;
const NODE_STORAGE_STORE_NAME = 'items';
const NODE_STORAGE_CACHE_TTL = 7 * 24 * 60 * 60 * 1000; // 7일

interface CachedNodeItem {
    key: string;
    data: ArrayBuffer;
    timestamp: number;
    hash: string; // SHA256 hash of the file content
}

// IndexedDB 초기화
async function openNodeStorageCache(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(NODE_STORAGE_DB_NAME, NODE_STORAGE_DB_VERSION);
        
        request.onerror = () => reject(request.error);
        request.onsuccess = () => resolve(request.result);
        
        request.onupgradeneeded = (event) => {
            const db = (event.target as IDBOpenDBRequest).result;
            if (!db.objectStoreNames.contains(NODE_STORAGE_STORE_NAME)) {
                const store = db.createObjectStore(NODE_STORAGE_STORE_NAME, { keyPath: 'key' });
                store.createIndex('timestamp', 'timestamp', { unique: false });
            }
        };
    });
}

// IndexedDB에서 아이템 읽기
async function getCachedNodeItem(key: string): Promise<{ data: Buffer, hash: string } | null> {
    try {
        const db = await openNodeStorageCache();
        return new Promise((resolve, reject) => {
            const transaction = db.transaction([NODE_STORAGE_STORE_NAME], 'readonly');
            const store = transaction.objectStore(NODE_STORAGE_STORE_NAME);
            const request = store.get(key);
            
            request.onerror = () => reject(request.error);
            request.onsuccess = () => {
                const result = request.result as CachedNodeItem | undefined;
                if (!result) {
                    resolve(null);
                    return;
                }
                
                // TTL 체크
                const now = Date.now();
                if (now - result.timestamp > NODE_STORAGE_CACHE_TTL) {
                    // 만료된 캐시 삭제
                    deleteCachedNodeItem(key).catch(console.error);
                    resolve(null);
                    return;
                }
                
                resolve({
                    data: Buffer.from(result.data),
                    hash: result.hash || ''
                });
            };
        });
    } catch (error) {
        console.error('Failed to get cached node item:', error);
        return null;
    }
}

// IndexedDB에 아이템 저장
async function setCachedNodeItem(key: string, data: Buffer, hash: string): Promise<void> {
    try {
        const db = await openNodeStorageCache();
        return new Promise((resolve, reject) => {
            const transaction = db.transaction([NODE_STORAGE_STORE_NAME], 'readwrite');
            const store = transaction.objectStore(NODE_STORAGE_STORE_NAME);
            const item: CachedNodeItem = {
                key,
                data: data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer,
                timestamp: Date.now(),
                hash: hash
            };
            const request = store.put(item);
            
            request.onerror = () => reject(request.error);
            request.onsuccess = () => resolve();
        });
    } catch (error) {
        console.error('Failed to set cached node item:', error);
    }
}

// IndexedDB에서 아이템 삭제
async function deleteCachedNodeItem(key: string): Promise<void> {
    try {
        const db = await openNodeStorageCache();
        return new Promise((resolve, reject) => {
            const transaction = db.transaction([NODE_STORAGE_STORE_NAME], 'readwrite');
            const store = transaction.objectStore(NODE_STORAGE_STORE_NAME);
            const request = store.delete(key);
            
            request.onerror = () => reject(request.error);
            request.onsuccess = () => resolve();
        });
    } catch (error) {
        console.error('Failed to delete cached node item:', error);
    }
}

// 모든 캐시 삭제
async function clearAllCachedNodeItems(): Promise<void> {
    try {
        const db = await openNodeStorageCache();
        return new Promise((resolve, reject) => {
            const transaction = db.transaction([NODE_STORAGE_STORE_NAME], 'readwrite');
            const store = transaction.objectStore(NODE_STORAGE_STORE_NAME);
            const request = store.clear();
            
            request.onerror = () => reject(request.error);
            request.onsuccess = () => resolve();
        });
    } catch (error) {
        console.error('Failed to clear cached node items:', error);
    }
}

// 서버에서 파일 해시 가져오기
async function getServerHash(key: string): Promise<string> {
    try {
        const response = await fetch('/api/hash', {
            method: 'GET',
            headers: {
                'file-path': Buffer.from(key, 'utf-8').toString('hex'),
                'risu-auth': auth
            }
        });
        
        if (response.status !== 200) {
            return '';
        }
        
        const data = await response.json();
        return data.hash || '';
    } catch (error) {
        console.error('Failed to get server hash:', error);
        return '';
    }
}

// =====================================================
// RisuSave 블록 기반 동기화
// =====================================================

interface BlockInfo {
    name: string;
    hash: string;
    length: number;
}

interface BlockHashesResponse {
    blocks: BlockInfo[] | null;
    totalSize: number;
    fileHash?: string; // RisuSave 포맷이 아닐 때
}

interface BlockData {
    name: string;
    data: string; // base64
    hash: string;
}

// 서버에서 블록 해시 정보 가져오기
async function getBlockHashes(key: string): Promise<BlockHashesResponse | null> {
    try {
        const response = await fetch('/api/block-hashes', {
            method: 'GET',
            headers: {
                'file-path': Buffer.from(key, 'utf-8').toString('hex'),
                'risu-auth': auth
            }
        });
        
        if (response.status !== 200) {
            return null;
        }
        
        return await response.json();
    } catch (error) {
        console.error('Failed to get block hashes:', error);
        return null;
    }
}

// 서버에서 특정 블록들 다운로드
async function downloadBlocks(key: string, blockNames: string[]): Promise<BlockData[]> {
    try {
        const response = await fetch('/api/block-read', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'file-path': Buffer.from(key, 'utf-8').toString('hex'),
                'risu-auth': auth
            },
            body: JSON.stringify({ blocks: blockNames })
        });
        
        if (response.status !== 200) {
            return [];
        }
        
        const data = await response.json();
        return data.blocks || [];
    } catch (error) {
        console.error('Failed to download blocks:', error);
        return [];
    }
}

// 블록별 캐시 키 생성
function getBlockCacheKey(fileKey: string, blockName: string): string {
    return `${fileKey}::block::${blockName}`;
}

// 블록 기반 getItem 구현 (RisuSave 전용)
async function getItemWithBlocks(key: string): Promise<Buffer | null> {
    // 1. 서버에서 블록 해시들 가져오기
    const serverInfo = await getBlockHashes(key);
    if (!serverInfo) {
        console.log(`[BlockSync] ${key}: 서버 정보 없음`);
        return null;
    }
    
    // RisuSave 포맷이 아니면 일반 해시 검증으로 폴백
    if (!serverInfo.blocks) {
        console.log(`[BlockSync] ${key}: RisuSave 포맷 아님 → 일반 해시 검증`);
        const cached = await getCachedNodeItem(key);
        if (cached && serverInfo.fileHash && cached.hash === serverInfo.fileHash) {
            return cached.data;
        }
        // 전체 다운로드 필요
        return null;
    }
    
    const serverBlocks = serverInfo.blocks;
    console.log(`[BlockSync] ${key}: 서버 블록 ${serverBlocks.length}개, 총 ${(serverInfo.totalSize / 1024 / 1024).toFixed(2)}MB`);
    
    // 2. 캐시된 블록들과 비교
    const changedBlocks: string[] = [];
    const cachedBlockData: Map<string, Buffer> = new Map();
    
    for (const serverBlock of serverBlocks) {
        const blockCacheKey = getBlockCacheKey(key, serverBlock.name);
        const cachedBlock = await getCachedNodeItem(blockCacheKey);
        
        if (!cachedBlock || cachedBlock.hash !== serverBlock.hash) {
            changedBlocks.push(serverBlock.name);
        } else {
            cachedBlockData.set(serverBlock.name, cachedBlock.data);
        }
    }
    
    // 3. 변경된 블록이 없으면 캐시에서 재조립
    if (changedBlocks.length === 0) {
        console.log(`[BlockSync] ${key}: 변경 없음 → 캐시에서 재조립`);
        
        // RISUSAVE 헤더 + 모든 블록
        const RISUSAVE_HEADER = Buffer.from('RISUSAVE\0');
        let totalSize = RISUSAVE_HEADER.length;
        for (const block of serverBlocks) {
            const blockData = cachedBlockData.get(block.name);
            if (blockData) {
                totalSize += blockData.length;
            }
        }
        
        const result = Buffer.alloc(totalSize);
        let offset = 0;
        RISUSAVE_HEADER.copy(result, offset);
        offset += RISUSAVE_HEADER.length;
        
        for (const block of serverBlocks) {
            const blockData = cachedBlockData.get(block.name);
            if (blockData) {
                blockData.copy(result, offset);
                offset += blockData.length;
            }
        }
        
        return result;
    }
    
    console.log(`[BlockSync] ${key}: ${changedBlocks.length}/${serverBlocks.length} 블록 변경됨 (${changedBlocks.slice(0, 5).join(', ')}${changedBlocks.length > 5 ? '...' : ''})`);
    
    // 4. 변경된 블록만 다운로드
    const newBlocks = await downloadBlocks(key, changedBlocks);
    
    const downloadedSize = newBlocks.reduce((sum, b) => sum + Buffer.from(b.data, 'base64').length, 0);
    console.log(`[BlockSync] ${key}: ${newBlocks.length}개 블록 다운로드 완료 (${(downloadedSize / 1024 / 1024).toFixed(2)}MB)`);
    
    // 5. 새 블록들 캐시에 저장
    for (const block of newBlocks) {
        const blockCacheKey = getBlockCacheKey(key, block.name);
        const blockBuffer = Buffer.from(block.data, 'base64');
        await setCachedNodeItem(blockCacheKey, blockBuffer, block.hash);
        cachedBlockData.set(block.name, blockBuffer);
    }
    
    // 6. 전체 파일 재조립
    const RISUSAVE_HEADER = Buffer.from('RISUSAVE\0');
    let totalSize = RISUSAVE_HEADER.length;
    for (const block of serverBlocks) {
        const blockData = cachedBlockData.get(block.name);
        if (blockData) {
            totalSize += blockData.length;
        }
    }
    
    const result = Buffer.alloc(totalSize);
    let offset = 0;
    RISUSAVE_HEADER.copy(result, offset);
    offset += RISUSAVE_HEADER.length;
    
    for (const block of serverBlocks) {
        const blockData = cachedBlockData.get(block.name);
        if (blockData) {
            blockData.copy(result, offset);
            offset += blockData.length;
        }
    }
    
    console.log(`[BlockSync] ${key}: 재조립 완료 (${(totalSize / 1024 / 1024).toFixed(2)}MB)`);
    return result;
}

export class NodeStorage{
    // Cache for keys() to avoid redundant API calls
    private keysCache: string[] | null = null;
    private keysCacheTime: number = 0;
    private readonly KEYS_CACHE_TTL = 5 * 60 * 1000; // 5분
    async setItem(key:string, value:Uint8Array):Promise<number> {
        await this.checkAuth()
        const da = await fetch('/api/write', {
            method: "POST",
            body: value as any,
            headers: {
                'content-type': 'application/octet-stream',
                'file-path': Buffer.from(key, 'utf-8').toString('hex'),
                'risu-auth': auth
            }
        })
        if(da.status < 200 || da.status >= 300){
            throw "setItem Error"
        }
        const data = await da.json()
        if(data.error){
            throw data.error
        }
        this.invalidateKeysCache(); // keys 캐시 무효화
        
        // 캐시 업데이트 (삭제 대신 새 데이터로 업데이트)
        if (key === 'database/database.bin') {
            // database.bin은 블록 기반으로 캐시 업데이트
            const buf = Buffer.from(value);
            const RISUSAVE_HEADER = Buffer.from('RISUSAVE\0');
            
            // RisuSave 포맷인지 확인
            if (buf.subarray(0, RISUSAVE_HEADER.length).equals(RISUSAVE_HEADER)) {
                // 블록 파싱 및 개별 저장
                let offset = RISUSAVE_HEADER.length;
                const blockNames: string[] = [];
                
                while (offset < buf.length) {
                    try {
                        const blockStart = offset;
                        const type = buf[offset];
                        const compression = buf[offset + 1] === 1;
                        offset += 2;
                        
                        const nameLength = buf[offset];
                        offset += 1;
                        const name = buf.subarray(offset, offset + nameLength).toString('utf-8');
                        offset += nameLength;
                        
                        const lengthBuf = Buffer.alloc(4);
                        buf.copy(lengthBuf, 0, offset, offset + 4);
                        const length = lengthBuf.readUInt32LE(0);
                        offset += 4;
                        
                        const blockData = buf.subarray(offset, offset + length);
                        offset += length;
                        
                        const blockEnd = offset;
                        
                        // 블록 해시 계산
                        const hashBuffer = await globalThis.crypto.subtle.digest('SHA-256', blockData);
                        const hashArray = Array.from(new Uint8Array(hashBuffer));
                        const hash = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
                        
                        // 블록 전체 (헤더 포함) 저장
                        const blockFullData = buf.subarray(blockStart, blockEnd);
                        const blockCacheKey = getBlockCacheKey(key, name);
                        await setCachedNodeItem(blockCacheKey, blockFullData, hash);
                        blockNames.push(name);
                    } catch (e) {
                        break;
                    }
                }
                
                console.log(`[BlockSync] ${key}: 로컬 저장 → 캐시 업데이트 (${blockNames.length} 블록)`);
            } else {
                // RisuSave 포맷 아니면 전체 해시로 저장
                const hashBuffer = await globalThis.crypto.subtle.digest('SHA-256', value.buffer as ArrayBuffer);
                const hashArray = Array.from(new Uint8Array(hashBuffer));
                const hash = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
                await setCachedNodeItem(key, buf, hash);
            }
        } else {
            // 일반 파일은 전체 해시로 저장
            const hashBuffer = await globalThis.crypto.subtle.digest('SHA-256', value.buffer as ArrayBuffer);
            const hashArray = Array.from(new Uint8Array(hashBuffer));
            const hash = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
            await setCachedNodeItem(key, Buffer.from(value), hash);
        }
        
        return data.mtime;
    }

    /**
     * Batch write multiple items in parallel
     * @param items - Array of {key, value} pairs
     * @param batchSize - Number of items per batch request (default: 50)
     * @param onProgress - Optional callback for progress updates
     */
    async setItemBatch(
        items: Array<{key: string, value: Uint8Array}>,
        batchSize: number = 128,
        onProgress?: (current: number, total: number) => void
    ): Promise<void> {
        await this.checkAuth()
        
        // Separate large files (>5MB) from small files
        const LARGE_FILE_THRESHOLD = 5 * 1024 * 1024; // 5MB
        const largeFiles = items.filter(item => item.value.length > LARGE_FILE_THRESHOLD);
        const smallFiles = items.filter(item => item.value.length <= LARGE_FILE_THRESHOLD);
        
        let processedCount = 0;
        
        // Process large files individually
        for (const item of largeFiles) {
            await this.setItem(item.key, item.value);
            processedCount++;
            if(onProgress) {
                onProgress(processedCount, items.length);
            }
        }
        
        // Process small files in batches using binary concat format
        for (let i = 0; i < smallFiles.length; i += batchSize) {
            const batch = smallFiles.slice(i, i + batchSize)
            
            // Concatenate files with length prefixes: [filename_len(4)][filename][data_len(4)][data]
            const chunks: Uint8Array[] = [];
            for (const item of batch) {
                const filenameBytes = new TextEncoder().encode(item.key);
                const filenameLenBuf = new Uint8Array(4);
                new DataView(filenameLenBuf.buffer).setUint32(0, filenameBytes.length, true);
                
                const dataLenBuf = new Uint8Array(4);
                new DataView(dataLenBuf.buffer).setUint32(0, item.value.length, true);
                
                chunks.push(filenameLenBuf, filenameBytes, dataLenBuf, item.value);
            }
            
            // Concat all chunks into single buffer
            const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
            const batchBuffer = new Uint8Array(totalLength);
            let offset = 0;
            for (const chunk of chunks) {
                batchBuffer.set(chunk, offset);
                offset += chunk.length;
            }
            
            const da = await fetch('/api/write-batch', {
                method: "POST",
                body: batchBuffer,
                headers: {
                    'content-type': 'application/octet-stream',
                    'risu-auth': auth
                }
            })
            
            if(da.status < 200 || da.status >= 300){
                throw "setItemBatch Error"
            }
            
            const data = await da.json()
            if(data.error){
                throw data.error
            }
            
            // Check for individual file errors
            const failedFiles = data.results?.filter((r: any) => !r.success)
            if(failedFiles && failedFiles.length > 0){
                console.warn('Some files failed to write:', failedFiles)
            }
            
            processedCount += batch.length;
            if(onProgress) {
                onProgress(processedCount, items.length);
            }
        }
        
        this.invalidateKeysCache(); // 캐시 무효화
    }

   async streamAssets(filePaths: string[], onFile:(name: string, file: Uint8Array) => void ) {
    await this.checkAuth()
    const da = await fetch('/api/assets/stream', {
        method: 'POST',
        headers: {
            'risu-auth': auth,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(filePaths)
    })

    if (da.status < 200 || da.status >= 300) {
        throw new Error("streamAssets Error")
    }

    const totalFiles = parseInt(da.headers.get('X-File-Count') || '0');
    const reader = da.body!.getReader();
    let receivedBuffer = Buffer.alloc(0);
    let filesProcessed = 0;
    const files = [];
    const globalHashData: Buffer[] = []; // 전역 해시용 데이터 모으기
    let fileCount: number | null = null;

    while (true) {
        const {done, value} = await reader.read();

        if (value) {
            receivedBuffer = Buffer.concat([receivedBuffer, Buffer.from(value)]);
        }

        if (fileCount === null && receivedBuffer.length >= 4) {
            fileCount = receivedBuffer.readUInt32LE(0);
            globalHashData.push(receivedBuffer.subarray(0, 4));
            receivedBuffer = receivedBuffer.subarray(4);
        }

        while (fileCount !== null && filesProcessed < fileCount) {
            if (receivedBuffer.length < 4) break;

            const filenameLen = receivedBuffer.readUInt32LE(0);
            
            if (receivedBuffer.length < 4 + filenameLen) break;
            
            const contentLen = receivedBuffer.readUInt32LE(4 + filenameLen);
            const totalNeeded = 4 + filenameLen + 4 + contentLen + 32;
            
            if (receivedBuffer.length < totalNeeded) break;

            let pos = 0;
            
            const filenameLenBuf = receivedBuffer.subarray(pos, pos + 4);
            pos += 4;
            globalHashData.push(filenameLenBuf);

            const filename = receivedBuffer.toString('utf8', pos, pos + filenameLen);
            globalHashData.push(receivedBuffer.subarray(pos, pos + filenameLen));
            pos += filenameLen;

            const contentLenBuf = receivedBuffer.subarray(pos, pos + 4);
            pos += 4;
            globalHashData.push(contentLenBuf);

            const content = receivedBuffer.subarray(pos, pos + contentLen);
            globalHashData.push(content);
            pos += contentLen;

            const receivedHash = receivedBuffer.subarray(pos, pos + 32);
            globalHashData.push(receivedHash);
            pos += 32;

            // 파일 무결성 검증 (crypto.subtle 사용)
            console.log(`[Debug] Verifying file: ${filename}, content length: ${content?.length}, contentLen: ${contentLen}`);
            if (!content || content.length === 0) {
                console.error(`[Error] Content is empty or undefined for file: ${filename}`);
                throw new Error(`Content is empty for file: ${filename}`);
            }
            const calculatedHashBuf = await globalThis.crypto.subtle.digest('SHA-256', content);
            const calculatedHash = Buffer.from(calculatedHashBuf);
            
            if (!receivedHash.equals(calculatedHash)) {
                throw new Error(`파일 ${filename} 무결성 검증 실패`);
            }

            files.push({ filename, content, size: contentLen });
            filesProcessed++;

            if (onFile) {
                onFile(filename, content);
            }

            receivedBuffer = receivedBuffer.subarray(pos);
        }

        if (done) {
            if (receivedBuffer.length === 32) {
                const receivedTotalHash = receivedBuffer;
                
                // 전체 데이터 합쳐서 해시 계산
                const allData = Buffer.concat(globalHashData);
                const calculatedTotalBuf = await globalThis.crypto.subtle.digest('SHA-256', allData);
                const calculatedTotalHash = Buffer.from(calculatedTotalBuf);
                
                if (!receivedTotalHash.equals(calculatedTotalHash)) {
                    throw new Error('전체 데이터 무결성 검증 실패');
                }
            }
            break;
        }
    }
    
    return files;
}
    async getItem(key:string):Promise<Buffer> {
        await this.checkAuth()
        
        // database.bin은 블록 기반 동기화 사용 (RisuSave 포맷 최적화)
        if (key === 'database/database.bin') {
            const result = await getItemWithBlocks(key);
            return result;
        }
        
        // 일반 파일: 기존 해시 검증 방식
        // IndexedDB 캐시 확인
        const cached = await getCachedNodeItem(key);
        if (cached) {
            // 해시 검증
            const serverHash = await getServerHash(key);
            
            if (serverHash && serverHash === cached.hash) {
                // 해시 일치 → 캐시 유효
                return cached.data;
            } else {
                // 해시 불일치 → 캐시 무효화
                await deleteCachedNodeItem(key);
                // 아래로 계속 진행하여 새 데이터 다운로드
            }
        }
        
        // 캐시가 없거나 무효화됨 → API 호출
        const da = await fetch('/api/read', {
            method: "GET",
            headers: {
                'file-path': Buffer.from(key, 'utf-8').toString('hex'),
                'risu-auth': auth
            }
        })
        if(da.status < 200 || da.status >= 300){
            throw "getItem Error"
        }

        const data = Buffer.from(await da.arrayBuffer())
        if (data.length == 0){
            return null
        }
        
        // 서버 해시 가져오기
        const serverHash = await getServerHash(key);
        
        // IndexedDB에 저장 (비동기, 실패해도 무시)
        setCachedNodeItem(key, data, serverHash).catch(console.error);
        
        return data
    }
    async keys():Promise<string[]>{
        await this.checkAuth()
        
        // 캐시 확인 (TTL 체크)
        const now = Date.now();
        if (this.keysCache !== null && (now - this.keysCacheTime) < this.KEYS_CACHE_TTL) {
            return this.keysCache;
        }
        
        // API 호출
        const da = await fetch('/api/list', {
            method: "GET",
            headers:{
                'risu-auth': auth
            }
        })
        const data = await da.json()
        if(da.status < 200 || da.status >= 300){
            throw "listItem Error"
        }
        if(data.error){
            throw data.error
        }
        
        // 캐시 저장
        this.keysCache = data.content;
        this.keysCacheTime = now;
        
        return data.content
    }
    async removeItem(key:string){
        await this.checkAuth()
        const da = await fetch('/api/remove', {
            method: "GET",
            headers: {
                'file-path': Buffer.from(key, 'utf-8').toString('hex'),
                'risu-auth': auth
            }
        })
        if(da.status < 200 || da.status >= 300){
            throw "removeItem Error"
        }
        const data = await da.json()
        if(data.error){
            throw data.error
        }
        this.invalidateKeysCache(); // 캐시 무효화
        await deleteCachedNodeItem(key); // 해당 파일 캐시 무효화
    }

    async removeItemBatch(keys: String[]) {
        await this.checkAuth()
        const da = await fetch('/api/remove-batch', {
            method: "POST",
            headers: {
                'risu-auth': auth,
                'content-type': 'application/json'
            },
            body: JSON.stringify(keys.map(key => Buffer.from(key, 'utf-8').toString('hex')))
        })
        if(da.status < 200 || da.status >= 300){
            throw "removeItemBatch Error"
        }
        const data = await da.json()
        if(data.error){
            throw data.error
        }
        this.invalidateKeysCache(); // 캐시 무효화
    }

    private async checkAuth(){
        if(!auth){
            auth = localStorage.getItem('risuauth')
        }

        if(!authChecked){
            const data = await (await fetch('/api/password',{
                headers: {
                    'risu-auth': auth ?? ''
                }
            })).json()

            if(data.status === 'unset'){
                const input = await digestPassword(await alertInput(language.setNodePassword))
                await fetch('/api/set_password',{
                    method: "POST",
                    body:JSON.stringify({
                        password: input 
                    }),
                    headers: {
                        'content-type': 'application/json'
                    }
                })
                auth = input
                localStorage.setItem('risuauth', auth)
            }
            else if(data.status === 'incorrect'){
                while(true){
                    const input = await digestPassword(await alertInput(language.inputNodePassword))
                    const data = await (await fetch('/api/password',{
                        headers: {
                            'risu-auth': input ?? ''
                        }
                    })).json()
                    if(data.status !== 'unset'){
                        auth = input
                        localStorage.setItem('risuauth', auth)
                        await this.checkAuth()
                        break
                    }
                }
            }
            else{
                authChecked = true
            }
        }
    }

    getAuth():string{
        return auth
    }
    
    /**
     * 캐시를 수동으로 무효화합니다.
     * 외부에서 파일 변경이 발생했을 때 호출할 수 있습니다.
     */
    invalidateKeysCache(): void {
        this.keysCache = null;
        this.keysCacheTime = 0;
    }
    
    /**
     * 특정 파일의 캐시를 무효화합니다.
     * @param key 무효화할 파일 키. undefined면 전체 캐시 삭제
     */
    async invalidateItemCache(key?: string): Promise<void> {
        if (key) {
            await deleteCachedNodeItem(key);
        } else {
            await clearAllCachedNodeItems();
        }
    }

    listItem = this.keys
}

async function digestPassword(message:string) {
    const crypt = await (await fetch('/api/crypto', {
        body: JSON.stringify({
            data: message
        }),
        headers: {
            'content-type': 'application/json'
        },
        method: "POST"
    })).text()
    
    return crypt;
}