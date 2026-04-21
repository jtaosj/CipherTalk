const fs = require('fs');
const path = require('path');
const { Arch } = require('electron-builder');

const IMAGE_NATIVE_PREFIX = 'ciphertalk-image-native-';
const IMAGE_NATIVE_SUFFIX = '.node';

function resolveNativePlatform(electronPlatformName) {
    if (electronPlatformName === 'darwin') return 'macos';
    if (electronPlatformName === 'win32') return 'win32';
    if (electronPlatformName === 'linux') return 'linux';
    return electronPlatformName;
}

function resolveNativeArch(arch) {
    if (typeof arch === 'string') return arch;
    if (typeof arch === 'number' && Arch[arch]) return Arch[arch];
    return process.arch;
}

function uniqueExistingDirs(candidates) {
    return Array.from(new Set(candidates)).filter((targetPath) => fs.existsSync(targetPath));
}

function rewriteNativeManifest(manifestPath, targetKey) {
    if (!fs.existsSync(manifestPath)) return;

    try {
        const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
        const nextActiveBinaries = {};
        if (manifest.activeBinaries && manifest.activeBinaries[targetKey]) {
            nextActiveBinaries[targetKey] = manifest.activeBinaries[targetKey];
        }
        manifest.activeBinaries = nextActiveBinaries;
        manifest.platforms = Object.keys(nextActiveBinaries);
        fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
        console.log(`已收敛 image native manifest 到当前平台: ${targetKey}`);
    } catch (error) {
        console.warn(`收敛 image native manifest 失败: ${manifestPath}`, error);
    }
}

function pruneImageNativeAddons(context) {
    const platformDir = resolveNativePlatform(context.electronPlatformName);
    const archDir = resolveNativeArch(context.arch);
    const targetFileName = `${IMAGE_NATIVE_PREFIX}${platformDir}-${archDir}${IMAGE_NATIVE_SUFFIX}`;
    const targetKey = `${platformDir}-${archDir}`;
    const productName = context.packager?.appInfo?.productFilename || 'CipherTalk';
    const resourceRoots = uniqueExistingDirs([
        path.join(context.appOutDir, 'resources'),
        path.join(context.appOutDir, 'Contents', 'Resources'),
        path.join(context.appOutDir, `${productName}.app`, 'Contents', 'Resources')
    ]);

    for (const resourceRoot of resourceRoots) {
        for (const nativeDir of [
            path.join(resourceRoot, 'resources', 'wedecrypt'),
            path.join(resourceRoot, 'wedecrypt')
        ]) {
            if (!fs.existsSync(nativeDir)) continue;

            const nativeFiles = fs.readdirSync(nativeDir)
                .filter((file) => file.startsWith(IMAGE_NATIVE_PREFIX) && file.endsWith(IMAGE_NATIVE_SUFFIX));
            if (nativeFiles.length === 0) continue;

            if (!nativeFiles.includes(targetFileName)) {
                console.warn(`未找到当前平台 image native addon，跳过裁剪: ${targetFileName}`);
                continue;
            }

            let deletedCount = 0;
            for (const file of nativeFiles) {
                if (file === targetFileName) continue;
                fs.rmSync(path.join(nativeDir, file), { force: true });
                deletedCount++;
            }

            rewriteNativeManifest(path.join(nativeDir, 'manifest.json'), targetKey);
            console.log(`已裁剪 image native addon，仅保留 ${targetFileName}，删除 ${deletedCount} 个无关文件。`);
        }
    }
}

exports.default = async function (context) {
    // context.appOutDir 是打包后的临时解压目录
    const localesDir = path.join(context.appOutDir, 'locales');

    if (fs.existsSync(localesDir)) {
        console.log('正在清理多余的 Chromium 语言包...');
        const files = fs.readdirSync(localesDir);

        // 只保留中文(简体/繁体)和英文
        const whitelist = [
            'zh-CN.pak',
            'en-US.pak'
        ];

        let deletedCount = 0;
        for (const file of files) {
            if (file.endsWith('.pak') && !whitelist.includes(file)) {
                fs.unlinkSync(path.join(localesDir, file));
                deletedCount++;
            }
        }
        console.log(`已删除 ${deletedCount} 个无关语言包，仅保留中英文。`);
    }

    pruneImageNativeAddons(context);

    if (context.electronPlatformName === 'darwin') {
        const productName = context.packager?.appInfo?.productFilename || 'CipherTalk';
        const launcherCandidates = [
            path.join(context.appOutDir, 'ciphertalk-mcp'),
            path.join(context.appOutDir, `${productName}.app`, 'Contents', 'MacOS', 'ciphertalk-mcp')
        ];

        for (const launcherPath of launcherCandidates) {
            if (!fs.existsSync(launcherPath)) continue;
            fs.chmodSync(launcherPath, 0o755);
            console.log(`已确保 macOS MCP 启动器可执行: ${launcherPath}`);
            break;
        }
    }
};
