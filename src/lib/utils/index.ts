import pathSystem     from "path";
import fsSystem       from "fs";
import fsExtra        from "fs-extra";
import os             from "os";
import { Time }       from "tspace-utils";
import { TResponse }  from "tspace-spear";
import { execSync } from 'child_process';
import type { 
  FileInfo, 
  TMetadata 
} from "../types";

export class Utils {
  private BACKUP: number = 30;

  private LAST_CPU_USAGE_CGROUP: number | null = null;
  private LAST_CPU_TIMESTAMP: number | null = null;

  private CGROUP_MEM_CURR = "/sys/fs/cgroup/memory.current";
  private CGROUP_MEM_MAX = "/sys/fs/cgroup/memory.max";
  private CGROUP_MEM_STAT = "/sys/fs/cgroup/memory.stat";
  private CGROUP_CPU_STAT = "/sys/fs/cgroup/cpu.stat";
  private ETC_HOSTNAME = "/etc/hostname";

  private FILE_META_CACHE = new Map<
    string,
    { stat: fsSystem.Stats; cachedAt: number }
  >();
  private FILE_META_CACHE_TTL_MS = 1000 * 60 * 10;

  constructor(
    private buckets: Function | null,
    private rootFolder: string,
    private metadata: string,
    private trash: string
  ) {}

  public setRootFolder(folder: string) {
    this.rootFolder = folder;
    return this;
  }

  public setMetaData(meta: string) {
    this.metadata = meta;
    return this;
  }

  public useHooks(
    fn: (() => void | Promise<void> | null) | null,
    ms: number
  ): () => void {
    if (!fn) return () => {};

    const interval = setInterval(() => {
      const result = fn();
      if (result instanceof Promise) result.catch(() => {});
    }, ms);

    return () => clearInterval(interval);
  }

  private async runConcurrent<T>(
    tasks: (() => Promise<T>)[],
    limit = 1000
  ): Promise<T[]> {
    const results: T[] = [];
    let i = 0;

    async function worker() {
      while (i < tasks.length) {
        const index = i++;
        results[index] = await tasks[index]();
      }
    }

    await Promise.all(Array(limit).fill(0).map(worker));
    return results;
  }

  public async getFileStat(filePath: string): Promise<fsSystem.Stats | null> {
    const now = new Time().toTimestamp();

    if (this.FILE_META_CACHE.has(filePath)) {
      const { stat, cachedAt } = this.FILE_META_CACHE.get(filePath)!;

      if (now - cachedAt < this.FILE_META_CACHE_TTL_MS) {
        return stat;
      }
      this.FILE_META_CACHE.delete(filePath);
    }

    try {
      const stat = await fsSystem.promises.lstat(filePath);
      this.FILE_META_CACHE.set(filePath, { stat, cachedAt: now });

      return stat;
    } catch (err) {
      return null;
    }
  }

  public getContainerId = () => {
    try {
      return fsSystem.readFileSync(this.ETC_HOSTNAME, "utf8").trim();
    } catch (err) {
      return null;
    }
  };

  public cpuAndMemoryUsage() {
    const readRamUsageFromCgroup = (find: "max" | "current"): number | null => {
      try {
        const cGroupPath =
          find === "max" ? this.CGROUP_MEM_MAX : this.CGROUP_MEM_CURR;

        const usageRaw = fsSystem.readFileSync(cGroupPath, "utf8").trim();

        if (usageRaw === "max") return null;

        const usage = parseInt(usageRaw, 10);

        if (isNaN(usage)) return null;

        if (find === "current") {
          const statRaw = fsSystem.readFileSync(this.CGROUP_MEM_STAT, "utf8");
          const inactiveFileLine = statRaw
            .split("\n")
            .find((line) => line.startsWith("inactive_file "));
          const inactiveFile = inactiveFileLine
            ? parseInt(inactiveFileLine.split(" ")[1], 10)
            : 0;
          return Math.max(0, usage - inactiveFile);
        }

        return usage;
      } catch (err) {
        return null;
      }
    };

    const readCpuUsageFromCgroup = (): number | null => {
      try {
        const data = fsSystem.readFileSync(this.CGROUP_CPU_STAT, "utf8");
        const stat = Object.fromEntries(
          data
            .trim()
            .split("\n")
            .map((line) =>
              line.split(/\s+/).map((v, i) => (i === 1 ? Number(v) : v))
            )
        );
        return stat.usage_usec || null;
      } catch {
        return null;
      }
    };

    const toMB = (v: number) => Number(Number(v / 1024 / 1024).toFixed(4));

    let ramUsed: number | null = readRamUsageFromCgroup("current");
    let ramTotal: number | null = readRamUsageFromCgroup("max");

    if (!ramTotal || !ramUsed) {
      ramUsed = process.memoryUsage().rss;
      ramTotal = os.totalmem();
    }

    const now = new Time().toTimeStamp();

    const cpuCgroupUsage = readCpuUsageFromCgroup();

    let cpuUsedPercent: number = 0;

    if (cpuCgroupUsage !== null) {
      if (
        this.LAST_CPU_USAGE_CGROUP === null ||
        this.LAST_CPU_TIMESTAMP === null
      ) {
        this.LAST_CPU_USAGE_CGROUP = cpuCgroupUsage;

        this.LAST_CPU_TIMESTAMP = now;

        cpuUsedPercent = 0;
      } else {
        const deltaUsage = cpuCgroupUsage - this.LAST_CPU_USAGE_CGROUP;

        const deltaTime = now - this.LAST_CPU_TIMESTAMP;

        this.LAST_CPU_USAGE_CGROUP = cpuCgroupUsage;

        this.LAST_CPU_TIMESTAMP = now;

        const cpus = os.cpus().length;

        cpuUsedPercent = (deltaUsage / (deltaTime * 1000 * cpus)) * 100;

        if (cpuUsedPercent < 0) cpuUsedPercent = 0;

        if (cpuUsedPercent > 100) cpuUsedPercent = 100;
      }
    } else {
      const cpus = os.cpus();

      const usageData = cpus.map((cpu) => {
        const total = Object.values(cpu.times).reduce(
          (acc, time) => acc + time,
          0
        );
        const active = total - cpu.times.idle;
        return (active / total) * 100;
      });

      cpuUsedPercent =
        usageData.reduce((acc, u) => acc + u, 0) / usageData.length || 0;
    }

    return {
      time: new Date().toISOString(),
      ram: {
        total: toMB(ramTotal || 0),
        used: toMB(ramUsed || 0),
      },
      cpu: {
        total: os.cpus().length,
        used: Math.min(100, +cpuUsedPercent.toFixed(4)),
      },
    };
  }

  public safelyParseJSON = (v: string) => {
    try {
      return JSON.parse(v);
    } catch (err) {
      return v;
    }
  };

  public removeDir = async (path: string) => {
    return await fsSystem.promises.rm(path, { recursive: true }).catch((_) => {
      return;
    });
  };

  public remove(
    path: string,
    { delayMs = 1000 * 60 * 60 }: { delayMs?: number } = {}
  ) {
    if (delayMs === 0) {
      fsSystem.promises.unlink(path).catch((err) => console.log(err));
      return;
    }

    setTimeout(() => {
      fsSystem.promises.unlink(path).catch((err) => console.log(err));
    }, delayMs);

    return;
  }

  public async trashed({ path, bucket }: { path: string; bucket: string }) {
    const folder = `${this.trash}/${new Time().onlyDate().toString()}`;

    const directory = this.normalizeDirectory({ bucket, folder });

    const newPath = this.normalizePath({ directory, path, full: true });

    const currentPath = this.normalizePath({
      directory: this.normalizeDirectory({ bucket, folder: null }),
      path,
      full: true,
    });

    const newDirectory = pathSystem.dirname(newPath);

    if (!(await this.fileExists(newDirectory))) {
      await fsSystem.promises.mkdir(newDirectory, {
        recursive: true,
      });
    }

    await fsSystem.promises.rename(currentPath, newPath).catch((err) => {
      console.log(err);
      return;
    });

    await this.syncMetadata(bucket).catch((_) => null);

    return;
  }

  public normalizeFolder(folder: string): string {
    return folder.replace(/^\/+/, "").replace(/[?#]/g, "");
  }

  public normalizeDirectory({
    bucket,
    folder,
  }: {
    bucket: string;
    folder?: string | null;
  }): string {
    return folder == null
      ? `${this.rootFolder}/${bucket}`
      : `${this.rootFolder}/${bucket}/${this.normalizeFolder(folder)}`;
  }

  public normalizePath({
    directory,
    path,
    full = false,
  }: {
    directory?: string | null;
    path: string;
    full?: boolean;
  }): string {
    path = path.replace(/^\/+/, "").replace(/\.{2}(?!\.)/g, "");

    const normalized = full
      ? directory == null
        ? pathSystem.join(pathSystem.resolve(), `${path}`)
        : pathSystem.join(pathSystem.resolve(), `${directory}/${path}`)
      : directory == null
      ? `${path}`
      : `${directory}/${path}`;

    return normalized;
  }

  public async pipeStream({
    res,
    bucket,
    filePath,
    range,
    download = false,
  }: {
    res: TResponse;
    bucket: string;
    filePath: string;
    range?: string;
    download: boolean;
  }) {
    const directory = this.normalizeDirectory({ bucket, folder: null });

    const path = this.normalizePath({ directory, path: filePath, full: true });

    const contentType = this.getContentType(
      String(filePath?.split(".")?.pop())
    );

    const stat = await this.getFileStat(path);

    if (stat == null) {
      throw new Error(`ENOENT: no such file or directory, open '${path}'`);
    }

    if (stat.isDirectory()) {
      throw new Error(`The stream is not support directory`);
    }

    const fileSize = stat.size;

    const writeHead = (header: Record<string, any>, code = 200) => {
      const extension = filePath.split(".").pop();
      const previews = Object.values({
        video: [
          "mp4", "webm", "ogg","ogv",
          "avi","mov","mkv","flv","f4v",
          "wmv","ts","mpeg",
        ],
        audio: ["wav", "mp3"],
        document: ["pdf"],
        image: ["png", "jpeg", "jpg", "gif", "webp", "svg", "ico"],
      }).flat();

      if (previews.some((p) => extension?.toLocaleLowerCase().includes(p))) {
        res.writeHead(download ? code : 206, header);
        return;
      }

      if (download) {
        res.setHeader(
          "Content-Disposition",
          `attachment; filename=${+new Date()}.${extension}`
        );
        res.setHeader("Content-Type", "application/octet-stream");
      }
    };

    const isVideo = contentType.startsWith("video/");

    try {
      if (!isVideo || range == null) {
        const header = {
          "Content-Length": fileSize,
          "Content-Type": contentType,
        };

        const stream = fsSystem.createReadStream(path);

        writeHead(header);

        return stream;
      }

      const parts = range.replace(/bytes=/, "").split("-");
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;

      const chunksize = end - start + 1;

      const stream = fsSystem.createReadStream(path, { start, end });

      const header = {
        "Content-Range": `bytes ${start}-${end}/${fileSize}`,
        "Accept-Ranges": "bytes",
        "Content-Length": chunksize,
        "Content-Type": contentType,
      };

      writeHead(header, 206);

      return stream;
    } catch (err) {
      throw err;
    }
  }

  public getContentType = (extension: string) => {
    switch (String(extension).toLowerCase()) {
      case "txt":
        return "text/plain";
      case "html":
      case "htm":
        return "text/html";
      case "css":
        return "text/css";
      case "js":
        return "application/javascript";
      case "json":
        return "application/json";
      case "xml":
        return "application/xml";
      case "pdf":
        return "application/pdf";
      case "doc":
      case "docx":
        return "application/msword";
      case "xls":
      case "xlsx":
        return "application/vnd.ms-excel";
      case "ppt":
      case "pptx":
        return "application/vnd.ms-powerpoint";
      case "jpg":
      case "jpeg":
        return "image/jpeg";
      case "png":
        return "image/png";
      case "gif":
        return "image/gif";
      case "bmp":
        return "image/bmp";
      case "svg":
        return "image/svg+xml";
      case "mp3":
        return "audio/mpeg";
      case "wav":
        return "audio/wav";
      case "ogg":
        return "audio/ogg";
      case "mp4":
        return "video/mp4";
      case "avi":
        return "video/x-msvideo";
      case "mpeg":
        return "video/mpeg";
      case "zip":
        return "application/zip";
      case "rar":
        return "application/x-rar-compressed";
      case "tar":
        return "application/x-tar";
      case "gz":
        return "application/gzip";
      case "7z":
        return "application/x-7z-compressed";
      default:
        return "application/octet-stream";
    }
  };

  public getMetadata = async (bucket: string): Promise<TMetadata | null> => {
    const directory: string = pathSystem.join(
      pathSystem.resolve(),
      `${this.rootFolder}/${bucket}/${this.metadata}`
    );

    const checkMetadata: boolean = await this.fileExists(directory);

    if (!checkMetadata) return null;

    const metadata: string = await fsSystem.promises.readFile(
      directory,
      "utf-8"
    );

    return this.safelyParseJSON(metadata) as TMetadata | null;
  };

  public async trashedWithFolder({
    path,
    bucket,
  }: {
    path: string;
    bucket: string;
  }) {
    const folder = `${this.trash}/${new Time().onlyDate().toString()}`;

    const directory = this.normalizeDirectory({ bucket, folder });

    const newPath = this.normalizePath({ directory, path, full: true });

    const currentPath = this.normalizePath({
      directory: this.normalizeDirectory({ bucket, folder: null }),
      path,
      full: true,
    });

    if (!(await this.fileExists(newPath))) {
      await fsSystem.promises.mkdir(newPath, {
        recursive: true,
      });
    }

    await fsExtra.copy(currentPath, newPath).catch((err) => console.log(err));

    await fsSystem.promises.rm(currentPath, { recursive: true, force: true });

    await this.syncMetadata(bucket).catch((_) => null);

    return;
  }

  public async fileExists(path: string): Promise<boolean> {
    try {
      await fsSystem.promises.access(path);
      return true;
    } catch (err) {
      return false;
    }
  }

  public removeOldDirInTrash = async (bucket: string) => {
    const directory = this.normalizeDirectory({ bucket, folder: this.trash });

    const files = await fsSystem.promises.readdir(directory);

    for (const file of files) {
      const dir = this.normalizePath({ directory, path: file, full: true });

      const stats = await this.getFileStat(dir);

      if (!stats?.isDirectory()) continue;

      const format = file.match(/^\d{4}-\d{2}-\d{2}/);

      const folderDate = new Time(format ? format[0] : 0).toTimestamp();

      const ago = new Time().minusDays(this.BACKUP).toTimeStamp();

      if (Number.isNaN(folderDate) || folderDate > ago) continue;

      await this.removeDir(dir);
    }
  };

  public syncMetadata = async (syncBuckets: string = "*"): Promise<void> => {
    try {
      const rootFolder = this.rootFolder;
      const buckets =
        this.buckets == null
          ? (
              await fsSystem.promises.readdir(
                pathSystem.join(pathSystem.resolve(), rootFolder)
              )
            ).filter(async (name) => {
              const stats = await this.getFileStat(
                pathSystem.join(rootFolder, name)
              );
              return stats?.isDirectory() ?? false;
            })
          : await this.buckets();

      const analyzeDirectory = async (dirPath: string) => {
        const info = {
          normal: {
            folderCount: 0,
            fileCount: 0,
            totalSize: 0,
          },
          trash: {
            folderCount: 0,
            fileCount: 0,
            totalSize: 0,
          },
        };

        const traverseDirectory = async (currentPath: string) => {
          const items = await fsSystem.promises
            .readdir(currentPath)
            .catch((_) => []);

          for (const item of items) {
            const itemPath = pathSystem.join(currentPath, item);
            const stat = await this.getFileStat(itemPath);

            if (stat == null) continue;

            if (stat.isDirectory() && itemPath.includes(this.trash)) {
              info.trash.folderCount++;
              await traverseDirectory(itemPath);
              continue;
            }

            if (
              stat.isFile() &&
              itemPath.includes(this.trash) &&
              item !== this.metadata
            ) {
              info.trash.fileCount++;
              info.trash.totalSize += stat.size;
              continue;
            }

            if (stat.isDirectory()) {
              info.normal.folderCount++;
              await traverseDirectory(itemPath);
            }

            if (stat.isFile() && item !== this.metadata) {
              info.normal.fileCount++;
              info.normal.totalSize += stat.size;
            }
          }
        };

        await traverseDirectory(pathSystem.join(dirPath));

        return info;
      };

      for (const bucket of buckets) {
        if (syncBuckets === "*" || syncBuckets === bucket) {
          const targetDir = `${rootFolder}/${bucket}`;

          const result = await analyzeDirectory(targetDir);

          // write file metadata to bucket
          await fsSystem.promises.writeFile(
            `${targetDir}/${this.metadata}`,
            JSON.stringify(
              {
                bucket,
                lastModified: new Date().toISOString(),
                info: {
                  files: result.normal.fileCount + result.trash.fileCount,
                  folders: result.normal.folderCount + result.trash.folderCount,
                  size: result.normal.totalSize + result.trash.totalSize,
                  sizes: {
                    bytes: result.normal.totalSize + result.trash.totalSize,
                    kb:
                      (result.normal.totalSize + result.trash.totalSize) / 1024,
                    mb:
                      (result.normal.totalSize + result.trash.totalSize) /
                      (1024 * 1024),
                    gb:
                      (result.normal.totalSize + result.trash.totalSize) /
                      (1024 * 1024 * 1024),
                  },
                },
                normal: {
                  files: result.normal.fileCount,
                  folders: result.normal.folderCount,
                  size: result.normal.totalSize,
                  sizes: {
                    bytes: result.normal.totalSize,
                    kb: result.normal.totalSize / 1024,
                    mb: result.normal.totalSize / (1024 * 1024),
                    gb: result.normal.totalSize / (1024 * 1024 * 1024),
                  },
                },
                trash: {
                  files: result.trash.fileCount,
                  folders: result.trash.folderCount,
                  size: result.trash.totalSize,
                  sizes: {
                    bytes: result.trash.totalSize,
                    kb: result.trash.totalSize / 1024,
                    mb: result.trash.totalSize / (1024 * 1024),
                    gb: result.trash.totalSize / (1024 * 1024 * 1024),
                  },
                },
              },
              null,
              2
            ),
            "utf-8"
          );
        }
      }

      return;
    } catch (err) {
      return;
    }
  };

  public async files(
    dir: string,
    {
      ignoreFolders = [],
      ignoreFiles = [],
    }: {
      ignoreFolders?: string[];
      ignoreFiles?: string[];
    } = {}
  ): Promise<string[]> {
    const directories = await fsSystem.promises
      .readdir(dir, { withFileTypes: true })
      .catch((_) => []);

    const files: any[] = await Promise.all(
      directories.map((directory) => {
        const newDir = pathSystem.resolve(String(dir), directory.name);

        if (
          directory.isDirectory() &&
          ignoreFolders.some((v) => v === directory.name)
        ) {
          return null;
        }

        if (
          directory.isFile() &&
          ignoreFiles.some((v) => v === directory.name)
        ) {
          return null;
        }

        return directory.isDirectory() ? this.files(newDir) : newDir;
      })
    );

    return [].concat(...files.filter(Boolean));
  }

  // public async fileStructure(
  //   dirPath: string,
  //   { includeFiles = false }: { includeFiles?: boolean } = {}
  // ): Promise<FileInfo[]> {
  //   const files = await fsSystem.promises.readdir(dirPath).catch(() => []);
  //   const rootLen = this.rootFolder.length + 1;

  //   const tasks = files.flatMap((file) => {
  //     if (file === this.metadata) return [];

  //     return [async () => {
  //       const fullPath = pathSystem.join(dirPath, file);
  //       const stats = await this.getFileStat(fullPath);
  //       if (!stats) return null;

  //       const isFolder = stats.isDirectory();
  //       if (!includeFiles && !isFolder) return null;

  //       const normalizedPath = fullPath.replace(/\\/g, '/').slice(rootLen);
  //       const isProtected = isFolder && file.includes(this.trash);

  //       return {
  //         name: file,
  //         path: normalizedPath,
  //         isFolder,
  //         lastModified: stats.mtime,
  //         size: isFolder ? null : stats.size,
  //         extension: isFolder
  //           ? isProtected ? 'system' : 'folder'
  //           : pathSystem.extname(file).replace(/^\./, '') || 'unknown',
  //         protected: isProtected,
  //       };
  //     }];
  //   });

  //   const results = await this.runConcurrent(tasks, 300);
  //   return results.filter((v): v is FileInfo => v !== null);
  // }

  public fileStructure = async (
    dirPath: string,
    {
      includeFiles = false,
    }: {
      includeFiles?: boolean;
    } = {}
  ): Promise<FileInfo[]> => {
    const files = await fsSystem.promises.readdir(dirPath).catch(() => []);

    const tasks = files.map((file) => {
      return async () => {
        if (file === this.metadata) return null;

        const fullPath = pathSystem.join(dirPath, file);

        const stats = await this.getFileStat(fullPath);

        if (!stats) return null;

        const isFolder = stats.isDirectory();

        if (!includeFiles && !isFolder) return null;

        const normalizedPath = fullPath
          .replace(/\\/g, "/")
          .replace(`${this.rootFolder}/`, "");
        const isProtected = isFolder && file.includes(this.trash);

        return {
          name: file,
          path: normalizedPath,
          isFolder,
          lastModified: stats.mtime,
          size: isFolder ? null : stats.size,
          extension: isFolder
            ? isProtected
              ? "system"
              : "folder"
            : pathSystem.extname(file).replace(/^\./, ""),
          protected: isProtected,
        };
      };
    });

    const results = await Promise.all(tasks.map((fn) => fn()));

    return results.filter((v): v is FileInfo => v !== null);
  };

  public getFolders = async (dir: string, base = dir): Promise<string[]> => {
    const items = await fsSystem.promises.readdir(dir);

    const promises = items.map((item) => {
      return async () => {
        const fullPath = pathSystem.join(dir, item);
        const stat = await this.getFileStat(fullPath);

        if (!stat?.isDirectory() || item === this.trash) return [];

        const relativePath = pathSystem.relative(base, fullPath);
        const nested = await this.getFolders(fullPath, base);
        return [relativePath, ...nested];
      };
    });

    const folders = await Promise.all(promises.map((fn) => fn()));

    return folders.flat().map((v) => v.replace(/\\/g, "/"));
  };

  getLogCommand(cid: string, tail = -1, namespace = 'default') {
    const tailOption = tail === -1 ? '' : `--tail=${tail}`;

    try {
      execSync(`docker inspect ${cid}`, { stdio: 'ignore' });
      return `docker logs ${tailOption} ${cid}`.trim();
    } catch (err: any) {}

    try {
      execSync(`kubectl get pod ${cid} -n ${namespace}`, {
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      return `kubectl logs ${tailOption} ${cid} -n ${namespace}`.trim();
    } catch (err: any) {}

    throw new Error(`Container or pod '${cid}' not found or not accessible via Docker or Kubernetes`);
  }
}
