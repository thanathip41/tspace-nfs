import pathSystem   from "path";
import fsSystem     from "fs";
import fsExtra      from "fs-extra";
import os           from 'os'
import { Time }     from "tspace-utils";

export class Utils {
  private backup: number = 30;

  private lastCpuUsageCgroup: number | null = null;
  private lastCpuTimestamp: number | null = null;

  private CGROUP_MEM_CURR = '/sys/fs/cgroup/memory.current';
  private CGROUP_MEM_MAX = '/sys/fs/cgroup/memory.max';
  private CGROUP_CPU_STAT = '/sys/fs/cgroup/cpu.stat';
  private ETC_HOSTNAME = '/etc/hostname';

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

  public useHooks(fn: (() => void | Promise<void> | null) | null, ms: number): () => void {
    if (!fn) return () => {};

    const interval = setInterval(() => {
      const result = fn();
      if (result instanceof Promise) result.catch(() => {})
    }, ms);

    return () => clearInterval(interval);
  }

  public getContainerId = () => {
    try {
      return fsSystem.readFileSync(this.ETC_HOSTNAME, 'utf8').trim();
    } catch (err) {
      return null;
    }
  }

  public cpuAndMemoryUsage() {

    const readRamUsageFromCgroup = (find : 'max' | 'current'): number | null => {
      try {
        const path = find === 'max' ? this.CGROUP_MEM_MAX : this.CGROUP_MEM_CURR

        const v = fsSystem.readFileSync(path, 'utf8');
        if (v === 'max') return null;
        return Number(v);

      } catch {
        return null;
      }
    }

    const readCpuUsageFromCgroup = (): number | null => {
      try {
        const data = fsSystem.readFileSync(this.CGROUP_CPU_STAT, 'utf8');
        const stat = Object.fromEntries(
          data
            .trim()
            .split('\n')
            .map(line => line.split(/\s+/).map((v, i) => (i === 1 ? Number(v) : v)))
        );
        return stat.usage_usec || null;
      } catch {
        return null;
      }
    }

    const toMB = (v : number) =>  Number(Number(v / 1024 / 1024).toFixed(4));

    let ramUsed: number | null  = readRamUsageFromCgroup('current')
    let ramTotal: number | null = readRamUsageFromCgroup('max')

    if (!ramTotal || !ramUsed) {
      ramUsed = process.memoryUsage().rss;
      ramTotal = os.totalmem();
    }

    const now = new Time().toTimeStamp();

    const cpuCgroupUsage = readCpuUsageFromCgroup();

    let cpuUsedPercent: number = 0;

    if (cpuCgroupUsage !== null) {
      if (this.lastCpuUsageCgroup === null || this.lastCpuTimestamp === null) {
        this.lastCpuUsageCgroup = cpuCgroupUsage;
        this.lastCpuTimestamp = now;
        cpuUsedPercent = 0;
      } else {
        const deltaUsage = cpuCgroupUsage - this.lastCpuUsageCgroup;
        const deltaTime = now - this.lastCpuTimestamp;

        this.lastCpuUsageCgroup = cpuCgroupUsage;
        this.lastCpuTimestamp = now;

        const cpus = os.cpus().length;
        cpuUsedPercent = (deltaUsage / (deltaTime * 1000 * cpus)) * 100;

        if (cpuUsedPercent < 0) cpuUsedPercent = 0;
        if (cpuUsedPercent > 100) cpuUsedPercent = 100;
      }
    } else {
      const cpus = os.cpus();
      const usageData = cpus.map(cpu => {
        const total = Object.values(cpu.times).reduce((acc, time) => acc + time, 0);
        const active = total - cpu.times.idle;
        return (active / total) * 100;
      });

      cpuUsedPercent = usageData.reduce((acc, u) => acc + u, 0) / usageData.length || 0;
    }

    return {
      ram: {
        total: toMB(ramTotal || 0),
        used: toMB(ramUsed || 0),
        time: new Date().toISOString(),
      },
      cpu: {
        total: os.cpus().length,
        used: Math.min(100,+cpuUsedPercent.toFixed(4)),
        time: new Date().toISOString(),
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

    await this.syncMetadata(bucket).catch(_ => null);

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

  public async makeStream({
    bucket,
    filePath,
    range,
    download = false,
  }: {
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

    const stat = fsSystem.statSync(path);

    if (stat.isDirectory()) {
      throw new Error(`The stream is not support directory`);
    }

    const fileSize = stat.size;

    const set = (header: Record<string, any>, filePath: string, code = 200) => {
      const extension = filePath.split(".").pop();

      const previews = [
        "ogv",
        "ogg",
        "webm",
        "wav",
        "mp3",
        "mp4",
        "pdf",
        "png",
        "jpeg",
        "jpg",
        "gif",
        "webp",
        "svg",
        "ico",
      ];

      return (res: any) => {
        if (previews.some((p) => extension?.toLocaleLowerCase() === p)) {
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
    };

    if (contentType !== "video/mp4") {
      const header = {
        "Content-Length": fileSize,
        "Content-Type": contentType,
      };

      return {
        stream: fsSystem.createReadStream(path),
        header,
        set: set(header, filePath),
      };
    }

    if (range == null) {
      const header = {
        "Content-Length": fileSize,
        "Content-Type": contentType,
      };

      return {
        stream: fsSystem.createReadStream(path).on("error", (err) => {
          throw err;
        }),
        header,
        set: set(header, filePath),
      };
    }

    const parts = range.replace(/bytes=/, "").split("-");
    const start = parseInt(parts[0], 10);
    const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;

    const chunksize = end - start + 1;

    const stream = fsSystem
      .createReadStream(path, { start, end })
      .on("error", (err) => {
        throw err;
      });

    const header = {
      "Content-Range": `bytes ${start}-${end}/${fileSize}`,
      "Accept-Ranges": "bytes",
      "Content-Length": chunksize,
      "Content-Type": contentType,
    };

    return {
      stream,
      header,
      set: set(header, filePath, 206),
    };
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

  public getMetadata = async (bucket: string) => {
    const directory: string = pathSystem.join(
      pathSystem.resolve(),
      `${this.rootFolder}/${bucket}/${this.metadata}`
    );

    const checkMetadata: boolean = fsSystem.existsSync(directory);

    if (!checkMetadata) return null;

    const metadata: string = await fsSystem.promises.readFile(
      directory,
      "utf-8"
    );

    return this.safelyParseJSON(metadata);
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

    await fsExtra
      .copy(currentPath, newPath)
      .then((_) => {
        fsSystem.rmSync(currentPath, { recursive: true, force: true });
      })
      .catch((err) => {
        console.log(err);
        return;
      });

    await this.syncMetadata(bucket).catch(_ => null);

    return;
  }

  public async fileExists(path: string): Promise<boolean> {
    try {
      await fsSystem.promises.stat(path);
      return true;
    } catch (err) {
      return false;
    }
  }

  public removeOldDirInTrash = async (bucket: string) => {
    const directory = this.normalizeDirectory({ bucket, folder: this.trash });

    const files = fsSystem.readdirSync(directory);

    for (const file of files) {
      const dir = this.normalizePath({ directory, path: file, full: true });

      const stats = await fsSystem.promises.stat(dir);

      if (!stats.isDirectory()) continue;

      const format = file.match(/^\d{4}-\d{2}-\d{2}/);

      const folderDate = new Time(format ? format[0] : 0).toTimestamp();

      const ago = new Time().minusDays(this.backup).toTimeStamp();

      if (Number.isNaN(folderDate) || folderDate > ago) continue;

      await this.removeDir(dir);
    }
  };

  public syncMetadata = async (syncBuckets: string = "*") => {
    const rootFolder = this.rootFolder;
    const buckets =
      this.buckets == null
        ? fsSystem
            .readdirSync(pathSystem.join(pathSystem.resolve(), rootFolder))
            .filter((name) => {
              return fsSystem
                .statSync(pathSystem.join(rootFolder, name))
                .isDirectory();
            })
        : await this.buckets();

    const analyzeDirectory = async (dirPath: string) => {
      let fileCount = 0;
      let folderCount = 0;
      let totalSize = 0;

      const traverseDirectory = async (currentPath: string) => {
        const items = await fsSystem.promises
          .readdir(currentPath)
          .catch((_) => []);

        for (const item of items) {
          const itemPath = pathSystem.join(currentPath, item);
          const stats = await fsSystem.promises
            .stat(itemPath)
            .catch((_) => null);

          if (stats == null) continue;

          if (stats.isDirectory() && item === this.trash) {
            continue;
          }

          if (stats.isDirectory()) {
            folderCount++;
            await traverseDirectory(itemPath);
          }

          if (stats.isFile() && item !== this.metadata) {
            fileCount++;
            totalSize += stats.size;
          }
        }
      };

      await traverseDirectory(pathSystem.join(dirPath));

      return { fileCount, folderCount, totalSize };
    };

    for (const bucket of buckets) {
      if (syncBuckets === "*" || syncBuckets === bucket) {
        const targetDir = `${rootFolder}/${bucket}`;

        const result = await analyzeDirectory(targetDir);

        // write file metadata to bucket
        fsSystem.writeFileSync(
          `${targetDir}/${this.metadata}`,
          JSON.stringify(
            {
              bucket,
              info: {
                files: result.fileCount,
                folders: result.folderCount,
                size: result.totalSize,
                sizes: {
                  bytes: result.totalSize,
                  kb: result.totalSize / 1024,
                  mb: result.totalSize / (1024 * 1024),
                  gb: result.totalSize / (1024 * 1024 * 1024),
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
  };

  public async files(
    dir: string,
    { ignore = null }: { ignore?: string | null } = {}
  ) {
    const directories = await fsSystem.promises
      .readdir(dir, { withFileTypes: true })
      .catch((_) => []);

    const files: any[] = await Promise.all(
      directories.map((directory) => {
        const newDir = pathSystem.resolve(String(dir), directory.name);

        if (
          directory.isDirectory() &&
          ignore != null &&
          directory.name === ignore
        ) {
          return null;
        }

        return directory.isDirectory() ? this.files(newDir) : newDir;
      })
    );

    return [].concat(...files.filter(Boolean));
  }

  public fileStructure = async (
    dirPath: string,
    { includeFiles = false, bucket }: { includeFiles?: boolean; bucket: string }
  ): Promise<any[]> => {
    const items: any[] = [];

    const files = await fsSystem.promises.readdir(dirPath).catch((_) => []);

    for (const file of files) {
      if (file === this.metadata) continue;

      const path = pathSystem.join(dirPath, file);

      const fullPath = pathSystem.join(pathSystem.resolve(), dirPath, file);

      const stats = await fsSystem.promises.lstat(fullPath).catch((_) => null);

      if (stats == null) continue;

      const lastModified = stats.mtime;

      if (stats?.isDirectory()) {
        items.push({
          name: file,
          path: path.replace(/\\/g, "/").replace(`${this.rootFolder}/`, ""),
          isFolder: true,
          lastModified,
          size: null,
          extension: "folder",
        });

        continue;
      }

      if (!includeFiles) continue;

      const extension = pathSystem.extname(file).replace(/\./g, "");

      items.push({
        name: file,
        path: path.replace(/\\/g, "/").replace(this.rootFolder, ""),
        isFolder: false,
        lastModified,
        size: stats.size,
        extension,
      });
    }

    return items;
  };
}
