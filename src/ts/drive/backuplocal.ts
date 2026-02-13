import { BaseDirectory, readFile, readDir, writeFile } from "@tauri-apps/plugin-fs";
import localforage from "localforage";
import { alertError, alertNormal, alertStore, alertWait, alertMd, alertConfirm } from "../alert";
import { LocalWriter, forageStorage, requiresFullEncoderReload } from "../globalApi.svelte";
import { isTauri } from "src/ts/platform"
import { decodeRisuSave, encodeRisuSaveLegacy } from "../storage/risuSave";
import { getDatabase, setDatabaseLite } from "../storage/database.svelte";
import { relaunch } from "@tauri-apps/plugin-process";
import { sleep } from "../util";
import { hubURL } from "../characterCards";
import { language } from "src/lang";
import { NodeStorage } from "../storage/nodeStorage";

function getBasename(data:string){
    const baseNameRegex = /\\/g
    const splited = data.replace(baseNameRegex, '/').split('/')
    const lasts = splited[splited.length-1]
    return lasts
}

export async function SaveLocalBackup(){
    const db = getDatabase()
    if(db.localBackupMethod === 'compatible'){
        await SaveLocalBackupLegacy()
    }
    else{
        await SaveLocalBackupFast()
    }
}

export async function SaveLocalBackupFast(){
    alertWait("Saving local backup...")
    const writer = new LocalWriter()
    const r = await writer.init()
    if(!r){
        alertError('Failed')
        return
    }

    const db = getDatabase()
    const assetMap = new Map<string, { charName: string, assetName: string }>()
    if (db.characters) {
        for (const char of db.characters) {
            if (!char) continue
            const charName = char.name ?? 'Unknown Character'
            
            if (char.image) assetMap.set(char.image, { charName: charName, assetName: 'Main Image' })
            
            if (char.emotionImages) {
                for (const em of char.emotionImages) {
                    if (em && em[1]) assetMap.set(em[1], { charName: charName, assetName: em[0] })
                }
            }
            if (char.type !== 'group') {
                if (char.additionalAssets) {
                    for (const em of char.additionalAssets) {
                        if (em && em[1]) assetMap.set(em[1], { charName: charName, assetName: em[0] })
                    }
                }
                if (char.vits) {
                    const keys = Object.keys(char.vits.files)
                    for (const key of keys) {
                        const vit = char.vits.files[key]
                        if (vit) assetMap.set(vit, { charName: charName, assetName: key })
                    }
                }
                if (char.ccAssets) {
                    for (const asset of char.ccAssets) {
                        if (asset && asset.uri) assetMap.set(asset.uri, { charName: charName, assetName: asset.name })
                    }
                }
            }
        }
    }
    if (db.userIcon) {
        assetMap.set(db.userIcon, { charName: 'User Settings', assetName: 'User Icon' })
    }
    if (db.customBackground) {
        assetMap.set(db.customBackground, { charName: 'User Settings', assetName: 'Custom Background' })
    }
    const missingAssets: string[] = []


    if(isTauri){
        const assets = await readDir('assets', {baseDir: BaseDirectory.AppData})
        let processedCount = 0;
        let lastUpdateTime = 0;

        for (const asset of assets) {
            processedCount++;
            const key = asset.name;
            if (!key) continue;

            try {
                // 대용량 파일 처리를 위해 순차적으로 읽고 쓰기 (메모리 문제 방지)
                const data = await readFile('assets/' + key, {baseDir: BaseDirectory.AppData});
                if (data) {
                    await writer.writeBackup(key, data);
                }
            } catch (e) {
                console.error(`Failed to backup asset: ${key}`, e);
                missingAssets.push(key);
            }

            // 진행률 업데이트 (100ms마다)
            if (Date.now() - lastUpdateTime > 100) {
                let message = `Saving local Backup... (${processedCount} / ${assets.length})`;
                if (missingAssets.length > 0) {
                     // 누락된 에셋 정보 표시 (이전과 동일)
                    const skippedItems = missingAssets.slice(-3).map(k => { // 최근 3개만 표시
                        const assetInfo = assetMap.get(k);
                        return assetInfo ? `'${assetInfo.assetName}'` : `'${k}'`;
                    }).join(', ');
                    if (missingAssets.length > 3) message += `\n(Skipping... ${skippedItems} +${missingAssets.length - 3} more)`;
                    else message += `\n(Skipping... ${skippedItems})`;
                }
                alertWait(message);
                lastUpdateTime = Date.now();
            }
        }
    }
    else{
        const keys = await forageStorage.keys()
        const BATCH_SIZE = 0x200;

        for (let i = 0; i < keys.length; i += BATCH_SIZE) {
            const batch = keys.slice(i, i + BATCH_SIZE);
            if (forageStorage.realStorage instanceof NodeStorage) {
                const pendingBatch = new Set(batch);
                await forageStorage.realStorage.streamAssets(batch, async (name, file) => {
                    if (file) {
                         await writer.writeBackup(name, file)
                         pendingBatch.delete(name)
                    }
                })
                
                // streamAssets가 끝난 후에도 Set에 남아있는 파일들은 누락된 것으로 간주
                for (const missing of pendingBatch) {
                    missingAssets.push(missing)
                }
            }
            else {
const readPromises = batch.map(async (key) => {
                if (!key) {
                    return null;
                }
                
                let data: Uint8Array | undefined;
                try {
                    if(forageStorage.isAccount && key.startsWith('assets/')){
                        const cached = await localforage.getItem(key) as ArrayBuffer;
                        if(cached) {
                            data = new Uint8Array(cached);
                        }
                    }
                    
                    if (!data) {
                        data = await forageStorage.getItem(key) as unknown as Uint8Array;
                    }
                    
                    if(data) return { key, data };
                    else return { key, missing: true };
                } catch {
                    return { key, error: true };
                }
            });

            const results = await Promise.all(readPromises);

            for (const res of results) {
                if (!res) continue;
                if (res.data) {
                    await writer.writeBackup(res.key, res.data);
                } else {
                    missingAssets.push(res.key);
                }
            }
        }
        let message = `Saving local Backup... (${Math.min(i + BATCH_SIZE, keys.length)} / ${keys.length})`;
        if (missingAssets.length > 0) {
            const skippedItems = missingAssets.map(key => {
                const assetInfo = assetMap.get(key);
                return assetInfo ? `'${assetInfo.assetName}' from ${assetInfo.charName}` : `'${key}'`;
            }).join(', ');
            message += `\n(Skipping... ${skippedItems})`;
        }
        alertWait(message);
        }
    }

    const dbData = encodeRisuSaveLegacy(getDatabase(), 'compression')

    alertWait(`Saving local Backup... (Saving database)`) 

    await writer.writeBackup('database.risudat', dbData)
    await writer.close()

    if (missingAssets.length > 0) {
        let message = 'Backup Successful, but the following assets were missing and skipped:\n\n'
        for (const key of missingAssets) {
            const assetInfo = assetMap.get(key)
            if (assetInfo) {
                message += `* **${assetInfo.assetName}** (from *${assetInfo.charName}*)  \n  *File: ${key}*\n`
            } else {
                message += `* **Unknown Asset**  \n  *File: ${key}*\n`
            }
        }
        alertMd(message)
    } else {
        alertNormal('Success')
    }
}

export async function SaveLocalBackupLegacy(){
    alertWait("Saving local backup...")
    const writer = new LocalWriter()
    const r = await writer.init()
    if(!r){
        alertError('Failed')
        return
    }

    const db = getDatabase()
    const assetMap = new Map<string, { charName: string, assetName: string }>()
    if (db.characters) {
        for (const char of db.characters) {
            if (!char) continue
            const charName = char.name ?? 'Unknown Character'
            
            if (char.image) assetMap.set(char.image, { charName: charName, assetName: 'Main Image' })
            
            if (char.emotionImages) {
                for (const em of char.emotionImages) {
                    if (em && em[1]) assetMap.set(em[1], { charName: charName, assetName: em[0] })
                }
            }
            if (char.type !== 'group') {
                if (char.additionalAssets) {
                    for (const em of char.additionalAssets) {
                        if (em && em[1]) assetMap.set(em[1], { charName: charName, assetName: em[0] })
                    }
                }
                if (char.vits) {
                    const keys = Object.keys(char.vits.files)
                    for (const key of keys) {
                        const vit = char.vits.files[key]
                        if (vit) assetMap.set(vit, { charName: charName, assetName: key })
                    }
                }
                if (char.ccAssets) {
                    for (const asset of char.ccAssets) {
                        if (asset && asset.uri) assetMap.set(asset.uri, { charName: charName, assetName: asset.name })
                    }
                }
            }
        }
    }
    if (db.userIcon) {
        assetMap.set(db.userIcon, { charName: 'User Settings', assetName: 'User Icon' })
    }
    if (db.customBackground) {
        assetMap.set(db.customBackground, { charName: 'User Settings', assetName: 'Custom Background' })
    }
    const missingAssets: string[] = []

    if(isTauri){
        const assets = await readDir('assets', {baseDir: BaseDirectory.AppData})
        let i = 0;
        for(let asset of assets){
            i += 1;
            let message = `Saving local Backup... (${i} / ${assets.length})`
            if (missingAssets.length > 0) {
                const skippedItems = missingAssets.map(key => {
                    const assetInfo = assetMap.get(key);
                    return assetInfo ? `'${assetInfo.assetName}' from ${assetInfo.charName}` : `'${key}'`;
                }).join(', ');
                message += `\n(Skipping... ${skippedItems})`;
            }
            alertWait(message)

            const key = asset.name
            if(!key){
                continue
            }
            const data = await readFile('assets/' + asset.name, {baseDir: BaseDirectory.AppData})
            if (data) {
                await writer.writeBackup(key, data)
            } else {
                missingAssets.push(key)
            }
        }
    }
    else{
        const keys = await forageStorage.keys()

        for(let i=0;i<keys.length;i++){
            const key = keys[i]
            let message = `Saving local Backup... (${i + 1} / ${keys.length})`
            if (missingAssets.length > 0) {
                const skippedItems = missingAssets.map(key => {
                    const assetInfo = assetMap.get(key);
                    return assetInfo ? `'${assetInfo.assetName}' from ${assetInfo.charName}` : `'${key}'`;
                }).join(', ');
                message += `\n(Skipping... ${skippedItems})`;
            }
            alertWait(message)

            if(!key){
                continue
            }
            let data: Uint8Array | undefined;
            let isCached = false;
            if(forageStorage.isAccount && key.startsWith('assets/')){
                const cached = await localforage.getItem(key) as ArrayBuffer;
                if(cached) {
                    isCached = true;
                    data = new Uint8Array(cached);
                }
            }
            
            if (!data) {
                data = await forageStorage.getItem(key) as unknown as Uint8Array
            }

            if (data) {
                await writer.writeBackup(key, data)
            } else {
                missingAssets.push(key)
            }
            if(forageStorage.isAccount && !isCached){
                await sleep(1000)
            }
        }
    }

    const dbWithoutAccount = { ...db, account: undefined }
    const dbData = encodeRisuSaveLegacy(dbWithoutAccount, 'compression')

    alertWait(`Saving local Backup... (Saving database)`) 

    await writer.writeBackup('database.risudat', dbData)
    await writer.close()

    if (missingAssets.length > 0) {
        let message = 'Backup Successful, but the following assets were missing and skipped:\n\n'
        for (const key of missingAssets) {
            const assetInfo = assetMap.get(key)
            if (assetInfo) {
                message += `* **${assetInfo.assetName}** (from *${assetInfo.charName}*)  \n  *File: ${key}*\n`
            } else {
                message += `* **Unknown Asset**  \n  *File: ${key}*\n`
            }
        }
        alertMd(message)
    } else {
        alertNormal('Success')
    }
}

/**
 * Saves a partial local backup with only critical assets.
 * 
 * Differences from SaveLocalBackup:
 * - Only includes profile images for characters/groups (excludes emotion images, additional assets, VITS files, CC assets)
 * - Additionally includes: persona icons, folder images, bot preset images
 * - Processes only assets in assetMap (selective) instead of all .png files in assets folder
 * - Faster and more efficient for quick backups
 * - Ideal for backing up core visual identity without bulk data
 */
export async function SavePartialLocalBackup(){
    // First confirmation: Explain the difference from regular backup
    const firstConfirm = await alertConfirm(language.partialBackupFirstConfirm)
    
    if (!firstConfirm) {
        return
    }
    
    // Second confirmation: Final warning about not saving assets
    const secondConfirm = await alertConfirm(language.partialBackupSecondConfirm)
    
    if (!secondConfirm) {
        return
    }
    
    alertWait("Saving partial local backup...")
    const writer = new LocalWriter()
    const r = await writer.init()
    if(!r){
        alertError('Failed')
        return
    }

    const db = getDatabase()
    const assetMap = new Map<string, { charName: string, assetName: string }>()
    
    // Only collect main profile images for both characters and groups
    if (db.characters) {
        for (const char of db.characters) {
            if (!char) continue
            const charName = char.name ?? 'Unknown Character'
            
            // Save the main profile image (supports both character and group types)
            // Note: emotionImages are intentionally excluded from partial backup
            if (char.image) {
                assetMap.set(char.image, { charName: charName, assetName: 'Profile Image' })
            }
        }
    }
    
    // User icon
    if (db.userIcon) {
        assetMap.set(db.userIcon, { charName: 'User Settings', assetName: 'User Icon' })
    }
    
    // Persona icons
    if (db.personas) {
        for (const persona of db.personas) {
            if (persona && persona.icon) {
                assetMap.set(persona.icon, { charName: 'Persona', assetName: `${persona.name} Icon` })
            }
        }
    }
    
    // Custom background
    if (db.customBackground) {
        assetMap.set(db.customBackground, { charName: 'User Settings', assetName: 'Custom Background' })
    }
    
    // Folder images in characterOrder
    if (db.characterOrder) {
        for (const item of db.characterOrder) {
            if (typeof item !== 'string' && item.img) {
                assetMap.set(item.img, { charName: 'Folder', assetName: `${item.name} Folder Image` })
            }
            if (typeof item !== 'string' && item.imgFile) {
                assetMap.set(item.imgFile, { charName: 'Folder', assetName: `${item.name} Folder Image File` })
            }
        }
    }
    
    // Bot preset images
    if (db.botPresets) {
        for (const preset of db.botPresets) {
            if (preset && preset.image) {
                assetMap.set(preset.image, { charName: 'Preset', assetName: `${preset.name} Preset Image` })
            }
        }
    }
    
    const missingAssets: string[] = []

    if(isTauri){
        // readDir returns entries without 'assets/' prefix, unlike forageStorage.keys()
        const assets = await readDir('assets', {baseDir: BaseDirectory.AppData})
        let i = 0;
        for(let asset of assets){
            if(!asset.name){
                continue
            }

            const keyWithPrefix = asset.name.startsWith('assets/') ? asset.name : `assets/${asset.name}`
            if(!keyWithPrefix.endsWith('.png')){
                continue
            }
            
            // Only process if this asset is in our map (profile images only)
            if(!assetMap.has(keyWithPrefix)){
                continue
            }
            
            i += 1;
            let message = `Saving partial local backup... (${i} / ${assetMap.size})`
            if (missingAssets.length > 0) {
                const skippedItems = missingAssets.map(key => {
                    const assetInfo = assetMap.get(key);
                    return assetInfo ? `'${assetInfo.assetName}' from ${assetInfo.charName}` : `'${key}'`;
                }).join(', ');
                message += `\n(Skipping... ${skippedItems})`;
            }
            alertWait(message)

            const data = await readFile(keyWithPrefix, {baseDir: BaseDirectory.AppData})
            if (data) {
                await writer.writeBackup(keyWithPrefix, data)
            } else {
                missingAssets.push(keyWithPrefix)
            }
        }
    }
    else{
        const keys = await forageStorage.keys()
        const assetKeys = Array.from(assetMap.keys())

        for(let i=0;i<assetKeys.length;i++){
            const key = assetKeys[i]
            let message = `Saving partial local backup... (${i + 1} / ${assetKeys.length})`
            if (missingAssets.length > 0) {
                const skippedItems = missingAssets.map(key => {
                    const assetInfo = assetMap.get(key);
                    return assetInfo ? `'${assetInfo.assetName}' from ${assetInfo.charName}` : `'${key}'`;
                }).join(', ');
                message += `\n(Skipping... ${skippedItems})`;
            }
            alertWait(message)

            if(!key || !key.endsWith('.png')){
                continue
            }
            
            let data: Uint8Array | undefined;
            let isCached = false;
            if(forageStorage.isAccount && key.startsWith('assets/')){
                const cached = await localforage.getItem(key) as ArrayBuffer;
                if(cached) {
                    isCached = true;
                    data = new Uint8Array(cached);
                }
            }
            
            if (!data) {
                data = await forageStorage.getItem(key) as unknown as Uint8Array
            }

            if (data) {
                await writer.writeBackup(key, data)
            } else {
                missingAssets.push(key)
            }
            if(forageStorage.isAccount && !isCached){
                await sleep(100)
            }
        }
    }

    const dbWithoutAccount = { ...db, account: undefined }
    const dbData = encodeRisuSaveLegacy(dbWithoutAccount, 'compression')

    alertWait(`Saving partial local backup... (Saving database)`) 

    await writer.writeBackup('database.risudat', dbData)
    await writer.close()

    if (missingAssets.length > 0) {
        let message = 'Partial backup successful, but the following profile images were missing and skipped:\n\n'
        for (const key of missingAssets) {
            const assetInfo = assetMap.get(key)
            if (assetInfo) {
                message += `* **${assetInfo.assetName}** (from *${assetInfo.charName}*)  \n  *File: ${key}*\n`
            } else {
                message += `* **Unknown Asset**  \n  *File: ${key}*\n`
            }
        }
        alertMd(message)
    } else {
        alertNormal('Success')
    }
}

export function LoadLocalBackup(){
    const db = getDatabase()
    if(db.localRestoreMethod === 'compatible'){
        LoadLocalBackupLegacy()
    }
    else{
        LoadLocalBackupFast()
    }
}

export function LoadLocalBackupFast(){
    try {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.bin';
        input.onchange = async () => {
            if (!input.files || input.files.length === 0) {
                input.remove();
                return;
            }
            const file = input.files[0];
            input.remove();

            const BATCH_SIZE = 128;
            const LARGE_FILE_THRESHOLD = 50 * 1024 * 1024; // 50MB
            const CHUNK_SIZE = 16 * 1024 * 1024; // 16MB chunks for large files
            const assetsToWrite: Array<{key: string, value: Uint8Array}> = [];
            const tauriAssetsToWrite: Array<{name: string, data: Uint8Array}> = [];
            let lastProgressUpdate = 0;
            
            const flushAssets = async (force = false) => {
                const shouldFlush = force || assetsToWrite.length >= BATCH_SIZE || tauriAssetsToWrite.length >= BATCH_SIZE;
                if (!shouldFlush) return;

                if (isTauri && tauriAssetsToWrite.length > 0) {
                    await Promise.all(tauriAssetsToWrite.map(item => 
                        writeFile(`assets/` + item.name, item.data, { baseDir: BaseDirectory.AppData })
                    ));
                    tauriAssetsToWrite.length = 0;
                } else if (!isTauri && assetsToWrite.length > 0) {
                    await forageStorage.setItemBatch(assetsToWrite, BATCH_SIZE);
                    assetsToWrite.length = 0;
                }
            };

            // 작은 데이터 읽기 (헤더용)
            const readBytes = async (start: number, length: number): Promise<Uint8Array> => {
                const blob = file.slice(start, start + length);
                const buffer = await blob.arrayBuffer();
                return new Uint8Array(buffer);
            };

            // 대용량 데이터 청크 단위로 읽기
            const readLargeData = async (start: number, length: number): Promise<Uint8Array> => {
                const chunks: Uint8Array[] = [];
                let bytesRead = 0;
                
                while (bytesRead < length) {
                    const chunkLength = Math.min(CHUNK_SIZE, length - bytesRead);
                    const blob = file.slice(start + bytesRead, start + bytesRead + chunkLength);
                    const buffer = await blob.arrayBuffer();
                    const chunk = new Uint8Array(buffer);
                    
                    // 실제 읽은 바이트 수 확인
                    if (chunk.length !== chunkLength) {
                        console.warn(`[LoadBackup] Chunk size mismatch: expected ${chunkLength}, got ${chunk.length}`);
                    }
                    
                    chunks.push(chunk);
                    bytesRead += chunk.length; // 실제 읽은 바이트 수 사용!
                    
                    // 진행 상황 업데이트
                    if (Date.now() - lastProgressUpdate > 200) {
                        const totalProgress = ((start + bytesRead) / file.size * 100).toFixed(1);
                        alertWait(`Loading large file... (${totalProgress}%)`);
                        lastProgressUpdate = Date.now();
                    }
                }
                
                // 청크들을 합치기
                const totalRead = chunks.reduce((sum, c) => sum + c.length, 0);
                console.log(`[LoadBackup] readLargeData: expected ${length}, actually read ${totalRead}`);
                
                const result = new Uint8Array(totalRead);
                let offset = 0;
                for (const chunk of chunks) {
                    result.set(chunk, offset);
                    offset += chunk.length;
                }
                return result;
            };

            let offset = 0;
            let recordCount = 0;
            
            // 파일 시작 부분 확인 (포맷 검증)
            const headerBytes = await readBytes(0, Math.min(100, file.size));
            const headerHex = Array.from(headerBytes.slice(0, 32)).map(b => b.toString(16).padStart(2, '0')).join(' ');
            console.log(`[LoadBackup] File header (first 32 bytes): ${headerHex}`);
            console.log(`[LoadBackup] File size: ${file.size} bytes`);
            
            // RisuSave 포맷 체크 (아마도 다른 포맷일 수 있음)
            const headerText = new TextDecoder().decode(headerBytes.slice(0, 20));
            console.log(`[LoadBackup] Header as text: ${headerText.replace(/[^\x20-\x7E]/g, '?')}`);
            
            try {
                while (offset < file.size) {
                    // 1. nameLength 읽기 (4 bytes)
                    if (offset + 4 > file.size) break;
                    const nameLengthBytes = await readBytes(offset, 4);
                    const nameLength = new DataView(nameLengthBytes.buffer).getUint32(0, true);
                    
                    if (nameLength > 10000) {
                        // 디버깅: 에러 지점 주변 바이트 출력
                        const debugBytes = await readBytes(offset, Math.min(64, file.size - offset));
                        const hexDump = Array.from(debugBytes.slice(0, 32)).map(b => b.toString(16).padStart(2, '0')).join(' ');
                        console.error(`[LoadBackup] Invalid nameLength=${nameLength} at offset=${offset}`);
                        console.error(`[LoadBackup] Bytes at error: ${hexDump}`);
                        
                        // 근처에서 유효한 nameLength(64 또는 68) 검색
                        console.log(`[LoadBackup] Searching for valid nameLength nearby...`);
                        for (let searchOffset = -8; searchOffset <= 8; searchOffset += 4) {
                            if (offset + searchOffset < 0) continue;
                            const testBytes = await readBytes(offset + searchOffset, 4);
                            const testLen = new DataView(testBytes.buffer).getUint32(0, true);
                            if (testLen === 64 || testLen === 68) {
                                // 다음 바이트가 '0'(0x30)으로 시작하는지 확인 (해시 시작)
                                const nextByte = await readBytes(offset + searchOffset + 4, 1);
                                if (nextByte[0] === 0x30) { // '0'
                                    console.log(`[LoadBackup] Found valid nameLength=${testLen} at offset=${offset + searchOffset} (drift=${searchOffset})`);
                                }
                            }
                        }
                        break;
                    }
                    
                    // 2. name 읽기
                    if (offset + 4 + nameLength > file.size) break;
                    const nameBytes = await readBytes(offset + 4, nameLength);
                    const name = new TextDecoder().decode(nameBytes);
                    
                    // 3. dataLength 읽기 (4 bytes)
                    if (offset + 4 + nameLength + 4 > file.size) break;
                    const dataLengthBytes = await readBytes(offset + 4 + nameLength, 4);
                    const dataLength = new DataView(dataLengthBytes.buffer).getUint32(0, true);
                    
                    if (dataLength > 2147483647) {
                        console.error(`[LoadBackup] Invalid dataLength=${dataLength} for ${name}`);
                        break;
                    }
                    
                    const dataStart = offset + 4 + nameLength + 4;
                    if (dataStart + dataLength > file.size) break;
                    
                    // 4. data 읽기 - 크기에 따라 다른 방식 사용
                    console.log(`[LoadBackup] Record #${recordCount}: name="${name.slice(0,20)}...", nameLen=${nameLength}, dataLen=${dataLength}`);
                    console.log(`[LoadBackup]   offset=${offset}, dataStart=${dataStart}, nextOffset=${dataStart + dataLength}`);
                    
                    const data = dataLength > LARGE_FILE_THRESHOLD 
                        ? await readLargeData(dataStart, dataLength)
                        : await readBytes(dataStart, dataLength);
                    
                    // 실제 읽은 바이트 수 확인
                    if (data.length !== dataLength) {
                        console.error(`[LoadBackup] Data size mismatch! expected=${dataLength}, got=${data.length}`);
                    }
                    
                    offset = dataStart + dataLength;
                    recordCount++;
                    
                    if (Date.now() - lastProgressUpdate > 100) {
                        const progress = ((offset / file.size) * 100).toFixed(1);
                        alertWait(`Loading backup... (${progress}%, ${recordCount} files)`);
                        lastProgressUpdate = Date.now();
                    }

                    if (name === 'database.risudat') {
                        await flushAssets(true);
                        
                        const db = new Uint8Array(data);
                        const dbData = await decodeRisuSave(db);
                        setDatabaseLite(dbData);
                        requiresFullEncoderReload.state = true;
                        
                        if (isTauri) {
                            await writeFile('database/database.bin', db, { baseDir: BaseDirectory.AppData });
                            await relaunch();
                            alertStore.set({ type: "wait", msg: "Success, Refreshing your app." });
                        } else {
                            await forageStorage.setItem('database/database.bin', db);
                            location.search = '';
                            alertStore.set({ type: "wait", msg: "Success, Refreshing your app." });
                        }
                    } else {
                        // 대용량 파일은 바로 저장
                        if (dataLength > LARGE_FILE_THRESHOLD) {
                            await flushAssets(true);
                            if (isTauri) {
                                await writeFile(`assets/` + name, data, { baseDir: BaseDirectory.AppData });
                            } else {
                                await forageStorage.setItem('assets/' + name, data);
                            }
                        } else {
                            if (isTauri) {
                                tauriAssetsToWrite.push({ name, data });
                            } else {
                                assetsToWrite.push({ key: 'assets/' + name, value: data });
                            }
                            await flushAssets(false);
                        }
                    }
                }
            } catch (e) {
                console.error('[LoadBackup] Error during parsing:', e);
                alertError('Failed, Is file corrupted?');
                return;
            }
            
            await flushAssets(true);
            alertNormal('Success');
        };

        input.click();
    } catch (error) {
        console.error(error);
        alertError('Failed, Is file corrupted?')
    }
}

export function LoadLocalBackupLegacy(){
    try {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.bin';
        input.onchange = async () => {
            if (!input.files || input.files.length === 0) {
                input.remove();
                return;
            }
            const file = input.files[0];
            input.remove();

            const reader = file.stream().getReader();
            const CHUNK_SIZE = 1024 * 1024; // 1MB chunk size
            let bytesRead = 0;
            let remainingBuffer = new Uint8Array();

            while (true) {
                const { done, value } = await reader.read();
                if (done) {
                    break;
                }

                bytesRead += value.length;
                const progress = ((bytesRead / file.size) * 100).toFixed(2);
                alertWait(`Loading local Backup... (${progress}%)`);

                const newBuffer = new Uint8Array(remainingBuffer.length + value.length);
                newBuffer.set(remainingBuffer);
                newBuffer.set(value, remainingBuffer.length);
                remainingBuffer = newBuffer;

                let offset = 0;
                while (offset + 4 <= remainingBuffer.length) {
                    const nameLength = new Uint32Array(remainingBuffer.slice(offset, offset + 4).buffer)[0];

                    if (offset + 4 + nameLength > remainingBuffer.length) {
                        break;
                    }
                    const nameBuffer = remainingBuffer.slice(offset + 4, offset + 4 + nameLength);
                    const name = new TextDecoder().decode(nameBuffer);

                    if (offset + 4 + nameLength + 4 > remainingBuffer.length) {
                        break;
                    }
                    const dataLength = new Uint32Array(remainingBuffer.slice(offset + 4 + nameLength, offset + 4 + nameLength + 4).buffer)[0];

                    if (offset + 4 + nameLength + 4 + dataLength > remainingBuffer.length) {
                        break;
                    }
                    const data = remainingBuffer.slice(offset + 4 + nameLength + 4, offset + 4 + nameLength + 4 + dataLength);

                    if (name === 'database.risudat') {
                        const db = new Uint8Array(data);
                        const dbData = await decodeRisuSave(db);
                        setDatabaseLite(dbData);
                        requiresFullEncoderReload.state = true;
                        if (isTauri) {
                            await writeFile('database/database.bin', db, { baseDir: BaseDirectory.AppData });
                            await relaunch();
                            alertStore.set({
                                type: "wait",
                                msg: "Success, Refreshing your app."
                            });
                        } else {
                            await forageStorage.setItem('database/database.bin', db);
                            location.search = '';
                            alertStore.set({
                                type: "wait",
                                msg: "Success, Refreshing your app."
                            });
                        }
                    } else {
                        if (isTauri) {
                            await writeFile(`assets/` + name, data, { baseDir: BaseDirectory.AppData });
                        } else {
                            await forageStorage.setItem('assets/' + name, data);
                        }
                    }
                    await sleep(10);
                    if (forageStorage.isAccount) {
                        await sleep(1000);
                    }

                    offset += 4 + nameLength + 4 + dataLength;
                }
                remainingBuffer = remainingBuffer.slice(offset);
            }

            alertNormal('Success');
        };

        input.click();
    } catch (error) {
        console.error(error);
        alertError('Failed, Is file corrupted?')
    }
}