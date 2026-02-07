import { language } from "src/lang"
import { alertInput } from "../alert"
let auth:string = null
let authChecked = false

export class NodeStorage{
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
        return data
    }
    async keys():Promise<string[]>{
        await this.checkAuth()
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