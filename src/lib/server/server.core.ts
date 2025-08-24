import pathSystem from "path";
import fsSystem from "fs";
import xml from "xml";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { Time } from "tspace-utils";
import { pipeline } from "stream/promises";
import { minify } from "html-minifier-terser";
import defaultHTML from "./default-html";
import { Queue } from "./server.queue";
import { Utils } from "../utils";
import { Spear, Router, TContext, TNextFunction } from "tspace-spear";
import type { TCredentials, TMeta, TMonitors, TRequestLog } from "../types";

class NfsServerCore {
  protected _buckets!: Function | null;
  protected _credentials!: ({
    token,
    secret,
    bucket,
  }: TCredentials) => Promise<boolean> | null;

  protected _monitors?: (params: TMonitors) => Promise<void>;
  protected _monitorsMs: number = 1000 * 30;

  protected _requestLog?: (params: TRequestLog[]) => Promise<void>;
  protected _requestLogMs: number = 1000 * 60 * 5;
  protected _requestLogData: TRequestLog[] = [];

  protected _app!: Spear;
  protected _router!: Router;
  protected _html!: string | null;

  protected _queue = new Queue(3);
  protected _fileExpired: number = 60 * 60;
  protected _rootFolder: string = "nfs";
  protected _jwtExipred: number = 60 * 60;
  protected _jwtSecret: string = `<secret@${+new Date()}:${Math.floor(
    Math.random() * 9999
  )}>`;
  protected _cluster: boolean | number = false;
  protected _progress: boolean = false;
  protected _debug: boolean = false;
  protected _trash: string = "@Recycle bin";
  protected _metadata: string = "@meta.json";
  protected _meta: TMeta = {};
  protected _logger: boolean = true;

  protected _utils = new Utils(
    this._buckets,
    this._rootFolder,
    this._metadata,
    this._trash
  );

  get instance() {
    return this._app;
  }

  /**
   * The 'progress' is method used to view the progress of the file upload.
   *
   * @returns {this}
   */
  debug(): this {
    this._debug = true;

    return this;
  }

  /**
   * The 'progress' is method used to view the progress of the file upload.
   *
   * @returns {this}
   */
  progress(): this {
    this._progress = true;

    return this;
  }

  /**
   * The 'defaultPage' is method used to set default home page.
   *
   * @param {string} html
   * @returns {this}
   */
  defaultPage(html: string): this {
    this._html = html;
    return this;
  }

  /**
   * The 'directory' is method used to set directory for root directory
   *
   * @param {string} folder
   * @returns {this}
   */
  directory(folder: string): this {
    this._rootFolder = folder;

    return this;
  }

  /**
   * The 'cluster' is method used to make cluster for server
   *
   * @param {number} workers
   * @returns {this}
   */
  cluster(workers?: number): this {
    this._cluster = workers == null ? true : workers;

    return this;
  }

  /**
   * The 'fileExpired' is method used to set file expiration
   *
   * @param {number} seconds
   * @returns {this}
   */
  fileExpired(seconds: number): this {
    this._fileExpired = seconds;
    return this;
  }

  /**
   * The 'credentials' is method used to set expiration and secret for credentials
   *
   * @param    {object}  credentials
   * @property {number}  credentials.expired by seconds
   * @property {string?} credentials.secret
   * @returns  {this}
   */
  credentials({ expired, secret }: { expired: number; secret?: string }): this {
    this._jwtExipred = expired;

    if (secret) {
      this._jwtSecret = secret;
    }

    return this;
  }

  /**
   * The 'bucketLists' method is used to inform the server about the available bucket lists.
   *
   * @param    {function} callback
   * @returns  {this}
   */
  bucketLists(callback: () => Promise<string[]>): this {
    this._buckets = callback;

    return this;
  }

  /**
   * The 'disabledLogger' method is used disabled Logger.
   *
   * @returns  {this}
   */
  disabledLogger (): this {
    this._logger = false;
    return this
  }

  /**
   * The 'onMonitors' is method used to monitors the server.
   *
   * @param    {function} callback
   * @property {string}   callback.host
   * @property {object}   callback.ram
   * @property {object}   callback.cpu
   * @returns  {this}
   */
  onMonitors(
    callback: (params: TMonitors) => Promise<void>,
    ms?: number
  ): this {
    this._monitors = callback;
    this._monitorsMs = ms ?? this._monitorsMs;
    return this;
  }

  /**
   * The 'onRequestLogs' is method used to watch requests in the server.
   *
   * @param    {function} callback
   * @property {string}   callback.bucket
   * @property {Date}     callback.time
   * @property {string}   callback.file
   * @property {string}   callback.path
   * @property {string}   callback.ip
   * @property {string}   callback.userAgent
   * @returns  {this}
   */
  onRequestLogs(
    callback: (params: TRequestLog[]) => Promise<void>,
    ms?: number
  ): this {
    this._requestLog = callback;
    this._requestLogMs = ms ?? this._requestLogMs;
    return this;
  }

  /**
   * The 'onBucketLists' method is used to inform the server about the available bucket lists.
   *
   * @param    {function} callback
   * @property {string[]}
   * @returns  {this}
   */
  onLoadBucketLists(callback: () => Promise<string[]>): this {
    this._buckets = callback;
    return this;
  }

  /**
   * The 'onCredentials' is method used to wrapper to check the credentials.
   *
   * @param    {function} callback
   * @returns  {this}
   */
  onCredentials(
    callback: ({
      token,
      secret,
      bucket,
    }: {
      token: string;
      secret: string;
      bucket: string;
    }) => Promise<boolean>
  ): this {
    this._credentials = callback;

    return this;
  }

  meta(meta: TMeta) {
    this._meta = meta;
    return this;
  }

  protected _default = async ({ req, res }: TContext) => {
    const html = this._html == null ? defaultHTML : String(this._html);
    const minifiedHtml = await minify(html, {
      collapseWhitespace: true,
      removeComments: true,
      minifyCSS: true,
      minifyJS: true,
    });

    const pkj = await this._utils.packageJson();

    const protocol = req.headers["x-forwarded-proto"] || "http";
    const host = `${req.headers.host}`;
    const url = `${protocol}://${host}`;

    const meta = {
      url: this._meta.url ?? url,
      title: this._meta.title ?? host,
      description: this._meta.description ?? pkj?.description,
      fav: this._meta.fav ?? "",
      keywords: this._meta.keywords ?? pkj?.keywords,
      robots: this._meta.robots ?? "index, nofollow",
      type: this._meta.type ?? "website",
    };

    const formatted = minifiedHtml
      .replaceAll("{{fav}}", meta.fav)
      .replaceAll("{{title}}", meta.title)
      .replaceAll("{{description}}", meta.description)
      .replaceAll("{{keywords}}", meta.keywords)
      .replaceAll("{{robots}}", meta.robots)
      .replaceAll("{{type}}", meta.type)
      .replaceAll("{{url}}", meta.url);

    return res.html(formatted);
  };

  protected _benchmark = () => {
    return "benchmark in nfs server";
  };

  protected _media = async ({ req, res, query, params }: TContext) => {
    const bucket = params.bucket;

    const path = String(params["*"])
      .replace(/^\/+/, "")
      .replace(/\.{2}(?!\.)/g, "");

    try {
      const {
        AccessKey = "",
        Expires = "",
        Signature = "",
        Download = "",
      } = query as Partial<
        Record<"AccessKey" | "Expires" | "Signature" | "Download", string>
      >;

      const combined = `@{${path}-${bucket}-${AccessKey}-${Expires}-${Download}}`;
      const compare = await bcrypt.compare(
        combined,
        Buffer.from(Signature, "base64").toString("utf-8")
      );

      const expired = Number.isNaN(+Expires)
        ? true
        : new Date(+Expires) < new Date();

      if (
        [AccessKey, Expires, Signature, Download, bucket].some(
          (v) => v === "" || v == null
        )
      ) {
        res.writeHead(400, { "Content-Type": "text/xml" });
        const error = {
          Error: [
            { Code: "Bad request" },
            { Message: "The request was invalid" },
            { Resource: req.url },
            { RequestKey: query?.AccessKey },
          ],
        };

        return res.end(xml([error], { declaration: true }));
      }

      if (this._requestLog != null) {
        this._requestLogData.push({
          time: new Date().toISOString(),
          bucket,
          ip:
            req.headers["x-forwarded-for"] ||
            req.ip ||
            req.socket?.remoteAddress,
          userAgent: req.headers["user-agent"],
          file: pathSystem.basename(path),
          path,
        });
      }

      if (!compare || expired) {
        const error = {
          Error: [
            { Code: expired ? "Expired" : "AccessDenied" },
            {
              Message: expired
                ? "Request has expired"
                : "The signature is not correct",
            },
            { Resource: req.url },
            { RequestKey: query?.AccessKey },
          ],
        };

        return res
        .writeHead(400, { "Content-Type": "text/xml" })
        .end(xml([error], { declaration: true }));
      }

      const stream = await this._utils.pipeStream({
        req,
        res,
        bucket: bucket,
        filePath: String(path),
        range: req.headers?.range,
        requests : {
          AccessKey,
          Expires,
          Signature
        },
        download:
          Download ===
          Buffer.from(`${Expires}@true`)
            .toString("base64")
            .replace(/[=|?|&]+$/g, ""),
      });

      if(stream == null) return;

      stream.on("error", () => res.end())
      
      return stream.pipe(res);
      
    } catch (err: any) {
      const message = String(err.message);

      const isNotFound = message.includes("ENOENT: no such file or directory");

      const error = {
        Error: [
          { Code: isNotFound ? "Not found" : "AccessDenied" },
          {
            Message: isNotFound ? `The file '${path}' does not exist` : message,
          },
          { Resource: req.url },
          { RequestKey: query.AccessKey },
        ],
      };

      return res
      .writeHead(isNotFound ? 404 : 400, { "Content-Type": "text/xml" })
      .end(xml([error], { declaration: true }));
    }
  };

  protected _apiFile = async ({ req, res, body }: TContext) => {
    try {
      const { bucket, token } = req;

      let { path, download, expired } = body;

      const fileName = `${path}`.replace(/^\/+/, "");

      const directory = this._utils.normalizeDirectory({
        bucket,
        folder: null,
      });

      const fullPath = this._utils.normalizePath({
        directory,
        path: String(path),
        full: true,
      });

      if (this._debug) {
        console.log({
          fullPath,
          path,
          download,
          expired,
        });
      }

      if (this._requestLog != null) {
        this._requestLogData.push({
          time: new Date().toISOString(),
          bucket,
          ip:
            req.headers["x-forwarded-for"] ||
            req.ip ||
            req.socket?.remoteAddress,
          userAgent: req.headers["user-agent"],
          file: pathSystem.basename(String(path)),
          path: String(path),
        });
      }

      if (!(await this._utils.fileExists(fullPath))) {
        return res.notFound(`No such directory or file, '${fileName}'`);
      }

      const key = String(token);

      const expires = new Time()
        .addSeconds(
          expired == null || Number.isNaN(Number(expired))
            ? this._fileExpired
            : Number(expired)
        )
        .toTimeStamp();

      const downloaded = `${Buffer.from(`${expires}@${download}`)
        .toString("base64")
        .replace(/[=|?|&]+$/g, "")}`;

      const combined = `@{${path}-${bucket}-${key}-${expires}-${downloaded}}`;

      const signature = Buffer.from(await bcrypt.hash(combined, 1)).toString(
        "base64"
      );

      return res.ok({
        endpoint: [
          `${bucket}/${fileName}?AccessKey=${key}`,
          `Expires=${expires}`,
          `Download=${downloaded}`,
          `Signature=${signature}`,
        ].join("&"),
      });
    } catch (err: any) {
      if (this._debug) {
        console.log(err);
      }

      return res.serverError(err.message);
    }
  };

  protected _apiBase64 = async ({ req, res, body }: TContext) => {
    try {
      const { bucket } = req;

      const { path: filename } = body;

      const directory = this._utils.normalizeDirectory({
        bucket,
        folder: null,
      });

      const path = this._utils.normalizePath({
        directory,
        path: String(filename),
        full: true,
      });

      if (this._requestLog != null) {
        this._requestLogData.push({
          time: new Date().toISOString(),
          bucket,
          ip:
            req.headers["x-forwarded-for"] ||
            req.ip ||
            req.socket?.remoteAddress,
          userAgent: req.headers["user-agent"],
          file: pathSystem.basename(String(path)),
          path: String(path),
        });
      }

      if (!(await this._utils.fileExists(path))) {
        return res.notFound(`no such file or directory, '${filename}'`);
      }

      const stat = await this._utils.getFileStat(path);

      if (stat?.isDirectory()) {
        return res.badRequest(
          "The path is a directory, cannot be read from the filesystem"
        );
      }

      return res.ok({
        base64: await fsSystem.promises.readFile(path, "base64"),
      });
    } catch (err: any) {
      if (this._debug) {
        console.log(err);
      }

      return res.serverError(err.message);
    }
  };

  protected _apiStream = async ({ req, res, body }: TContext) => {
    try {
      const { bucket } = req;

      const { path, range } = body;

      const directory = this._utils.normalizeDirectory({
        bucket,
        folder: null,
      });

      const fullPath = this._utils.normalizePath({
        directory,
        path: String(path),
        full: true,
      });

      if (this._requestLog != null) {
        this._requestLogData.push({
          time: new Date().toISOString(),
          bucket,
          ip:
            req.headers["x-forwarded-for"] ||
            req.ip ||
            req.socket?.remoteAddress,
          userAgent: req.headers["user-agent"],
          file: pathSystem.basename(String(path)),
          path: String(path),
        });
      }

      if (!(await this._utils.fileExists(fullPath))) {
        return res.notFound(`no such file or directory, '${path}'`);
      }

      const stat = await this._utils.getFileStat(fullPath);

      const fileSize = stat?.size ?? 0;

      if (range) {
        const parts = String(range)
          .replace(/bytes=/, "")
          .split("-");
        const start = parseInt(parts[0], 10);
        const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
        const chunksize = end - start + 1;
        const file = fsSystem.createReadStream(fullPath, { start, end });
        const head = {
          "Content-Range": `bytes ${start}-${end}/${fileSize}`,
          "Accept-Ranges": "bytes",
          "Content-Length": chunksize,
          "Content-Type": "video/mp4",
        };
        res.writeHead(206, head);
        return file.pipe(res);
      }

      const head = {
        "Content-Length": fileSize,
        "Content-Type": "video/mp4",
      };
      res.writeHead(200, head);

      return fsSystem.createReadStream(fullPath).pipe(res);
    } catch (err) {
      if (this._debug) {
        console.log(err);
      }

      throw err;
    }
  };

  protected _apiMeta = async ({ req, res, body }: TContext) => {
    try {
      const { bucket } = req;

      const { path } = body;

      const directory = this._utils.normalizeDirectory({
        bucket,
        folder: null,
      });

      const fullPath = this._utils.normalizePath({
        directory,
        path: String(path),
        full: true,
      });

      if (this._requestLog != null) {
        this._requestLogData.push({
          time: new Date().toISOString(),
          bucket,
          ip:
            req.headers["x-forwarded-for"] ||
            req.ip ||
            req.socket?.remoteAddress,
          userAgent: req.headers["user-agent"],
          file: pathSystem.basename(String(path)),
          path: String(path),
        });
      }

      if (!(await this._utils.fileExists(fullPath))) {
        return res.notFound(`no such file or directory, '${path}'`);
      }

      const stats = await this._utils.getFileStat(fullPath);
      const isDirectory = stats?.isDirectory() ? true : false;
      const extension = String(fullPath?.split(".")?.pop());

      return {
        isDirectory,
        size: isDirectory ? 0 : stats?.size,
        createdAt: stats?.birthtime,
        modifiedAt: stats?.mtime,
        extension: isDirectory ? "folder" : extension,
        contenType: isDirectory ? null : this._utils.getContentType(extension),
      };
    } catch (err) {
      if (this._debug) {
        console.log(err);
      }

      throw err;
    }
  };

  protected _apiStorage = async ({ req, res, body }: TContext) => {
    try {
      const { bucket } = req;

      let { folder } = body;

      if (folder != null) {
        folder = this._utils.normalizeFolder(String(folder));
      }

      const directory = this._utils.normalizeDirectory({ bucket, folder });

      if (this._requestLog != null) {
        this._requestLogData.push({
          time: new Date().toISOString(),
          bucket,
          ip:
            req.headers["x-forwarded-for"] ||
            req.ip ||
            req.socket?.remoteAddress,
          userAgent: req.headers["user-agent"],
          file: pathSystem.basename(String(folder)),
          path: String(folder),
        });
      }

      if (!(await this._utils.fileExists(directory))) {
        return res.notFound(`No such directory or folder, '${folder}'`);
      }

      const fileDirectories = await this._utils.files(directory, {
        ignoreFolders: [this._trash],
        ignoreFiles: [this._metadata],
      });

      const promises = fileDirectories.map((dir) => {
        return async () => {
          if (dir === this._metadata) return null;

          const stat = await this._utils.getFileStat(dir);
          const fileSize = stat?.size ?? 0;
          const path = pathSystem.relative(directory, dir).replace(/\\/g, "/");
          const name = pathSystem.basename(path);

          return {
            path,
            name,
            size: Number(fileSize / (1024 * 1024)),
            sizes: {
              bytes: fileSize,
              kb: fileSize / 1024,
              mb: fileSize / 1024 / 1024,
              gb: fileSize / 1024 / 1024 / 1024,
            },
          };
        };
      });

      const results = await Promise.all(promises.map((fn) => fn())).catch(
        (_) => []
      );

      const storage = results.filter(Boolean);

      return res.ok({
        storage,
      });
    } catch (err: any) {
      if (this._debug) {
        console.log(err);
      }

      return res.serverError(err.message);
    }
  };

  protected _apiFolders = async ({ req, res, body }: TContext) => {
    try {
      const { bucket } = req;

      let folder = body?.folder as string | null;

      if (Array.isArray(folder)) {
        folder = folder.join("/");
      }

      const directory = this._utils.normalizeDirectory({
        bucket,
        folder: folder ?? null,
      });

      if (this._requestLog != null) {
        this._requestLogData.push({
          time: new Date().toISOString(),
          bucket,
          ip:
            req.headers["x-forwarded-for"] ||
            req.ip ||
            req.socket?.remoteAddress,
          userAgent: req.headers["user-agent"],
          file: pathSystem.basename(String("")),
          path: String(""),
        });
      }

      const folders = await this._utils.getFolders(directory).catch((_) => []);

      return res.ok({
        folders,
      });
    } catch (err: any) {
      if (this._debug) {
        console.log(err);
      }

      return res.serverError(err.message);
    }
  };

  protected _apiUpload = async ({ req, res, files, body }: TContext) => {
    try {
      const { bucket } = req;

      if (!Array.isArray(files?.file)) {
        return res.badRequest("The file is required.");
      }

      const file = files?.file[0];

      if (file == null) {
        return res.badRequest("The file is required.");
      }

      let { folder } = body;

      if (folder != null) {
        folder = this._utils.normalizeFolder(String(folder));
      }

      const directory = this._utils.normalizeDirectory({ bucket, folder });

      if (!(await this._utils.fileExists(directory))) {
        if (this._debug) {
          console.log({ directory, bucket, folder });
        }

        await fsSystem.promises.mkdir(directory, {
          recursive: true,
        });
      }

      const writeFile = (file: string, to: string) => {
        return new Promise<null>((resolve, reject) => {
          fsSystem
            .createReadStream(file)
            .pipe(fsSystem.createWriteStream(to))
            .on("finish", () => {
              // remove temporary from chunked by nfs-client
              this._utils.remove(to);
              // remove temporary from server
              this._utils.remove(file, { delayMs: 0 });
              return resolve(null);
            })
            .on("error", (err) => reject(err));
          return;
        });
      };

      await writeFile(
        file.tempFilePath,
        this._utils.normalizePath({ directory, path: file.name, full: true })
      );

      await this._utils.syncMetadata(bucket).catch((_) => null);

      const path = this._utils.normalizePath({
        directory: folder,
        path: file.name,
      });

      return res.ok({
        path,
        name: file.name,
        size: file.size,
      });
    } catch (err) {
      if (this._debug) {
        console.log(err, "here!");
      }

      throw err;
    }
  };

  protected _apiMerge = async ({ req, res, body }: TContext) => {
    try {
      const { bucket } = req;

      let { folder, name, paths, totalSize } = body as {
        folder?: string | null;
        name: string;
        paths: string[];
        totalSize: number;
      };

      if (folder != null) {
        folder = this._utils.normalizeFolder(String(folder));
      }

      const directory = this._utils.normalizeDirectory({ bucket, folder });

      if (!(await this._utils.fileExists(directory))) {
        await fsSystem.promises.mkdir(directory, {
          recursive: true,
        });
      }

      const writeFile = async (to: string) => {
        return new Promise((resolve, reject) => {
          const writeStream = fsSystem.createWriteStream(to, { flags: "a" });

          writeStream.on("error", (err) => {
            return reject(err);
          });

          let processedSize = 0;

          const next = (index: number = 0) => {
            if (index >= paths.length) {
              writeStream.end();

              writeStream.close();

              return resolve(null);
            }

            const partPath = this._utils.normalizePath({
              directory,
              path: paths[index],
              full: true,
            });

            const readStream = fsSystem.createReadStream(partPath, {
              highWaterMark: 1024 * 1024 * 100,
            });

            if (this._progress) {
              readStream.on("data", (chunk: string) => {
                processedSize += chunk.length;
                const progress = (processedSize / totalSize) * 100;

                console.log(
                  `The file '${pathSystem.basename(
                    to
                  )}' in progress: ${progress.toFixed(2)}%`
                );
              });
            }

            readStream.on("error", (err) => {
              return reject(err);
            });

            readStream.on("end", () => {
              this._utils.remove(partPath, { delayMs: 0 });
              next(index + 1);
            });

            readStream.pipe(writeStream, { end: false });
          };

          next();
        });
      };

      const to = this._utils.normalizePath({
        directory,
        path: name,
        full: true,
      });

      await writeFile(to);

      await this._utils.syncMetadata(bucket);

      const path = this._utils.normalizePath({ directory: folder, path: name });

      if (this._requestLog != null) {
        this._requestLogData.push({
          time: new Date().toISOString(),
          bucket,
          ip:
            req.headers["x-forwarded-for"] ||
            req.ip ||
            req.socket?.remoteAddress,
          userAgent: req.headers["user-agent"],
          file: pathSystem.basename(String(path)),
          path: String(path),
        });
      }

      const stats = await this._utils.getFileStat(to);

      return res.ok({
        path,
        name: name,
        size: stats?.size,
      });
    } catch (err) {
      if (this._debug) {
        console.log(err);
      }

      throw err;
    }
  };

  protected _apiUploadStream = async ({ req, res, query }: TContext) => {
    try {
      const { bucket } = req;

      const fileName = String(req.headers["x-file-name"] ?? null);

      if (fileName == null) {
        return res.badRequest("The file is required.");
      }

      let folder = String(req.headers["x-folder-name"] ?? null);

      if (folder != null) {
        folder = this._utils.normalizeFolder(String(folder));
      }

      const directory = this._utils.normalizeDirectory({ bucket, folder });

      const chunkPath = pathSystem.join(directory, `${fileName}`);

      const writeStream = fsSystem.createWriteStream(chunkPath);

      await pipeline(req, writeStream);

      const stats = await this._utils.getFileStat(chunkPath);

      await this._utils.syncMetadata(bucket);

      const path = this._utils.normalizePath({
        directory: folder,
        path: fileName,
      });

      if (this._requestLog != null) {
        this._requestLogData.push({
          time: new Date().toISOString(),
          bucket,
          ip:
            req.headers["x-forwarded-for"] ||
            req.ip ||
            req.socket?.remoteAddress,
          userAgent: req.headers["user-agent"],
          file: pathSystem.basename(String(path)),
          path: String(path),
        });
      }

      return res.ok({
        path,
        name: fileName,
        size: stats?.size,
      });
    } catch (err) {
      if (this._debug) {
        console.log(err);
      }

      throw err;
    }
  };

  protected _apiUploadBase64 = async ({ req, res, body }: TContext) => {
    try {
      const { bucket } = req;

      let { folder, base64, name } = body;

      if (folder != null) {
        folder = this._utils.normalizeFolder(String(folder));
      }

      if (base64 === "" || base64 == null) {
        return res.badRequest("The base64 is required.");
      }

      if (name === "" || name == null) {
        return res.badRequest("The name is required.");
      }

      const directory = this._utils.normalizeDirectory({ bucket, folder });

      if (!(await this._utils.fileExists(directory))) {
        await fsSystem.promises.mkdir(directory, {
          recursive: true,
        });
      }

      const writeFile = async (base64: string, to: string) => {
        return fsSystem.promises.writeFile(to, String(base64), "base64");
      };

      const to = pathSystem.join(pathSystem.resolve(), `${directory}/${name}`);

      await writeFile(String(base64), to);

      const path = this._utils.normalizePath({
        directory: folder,
        path: String(name),
      });

      await this._utils.syncMetadata(bucket);

      if (this._requestLog != null) {
        this._requestLogData.push({
          time: new Date().toISOString(),
          bucket,
          ip:
            req.headers["x-forwarded-for"] ||
            req.ip ||
            req.socket?.remoteAddress,
          userAgent: req.headers["user-agent"],
          file: pathSystem.basename(String(path)),
          path: String(path),
        });
      }

      const stats = await this._utils.getFileStat(to).catch((_) => null);

      return res.ok({
        path,
        name: name,
        size: stats?.size,
      });
    } catch (err) {
      if (this._debug) {
        console.log(err);
      }

      throw err;
    }
  };

  protected _apiRemove = async ({ req, res, body }: TContext) => {
    try {
      const { bucket } = req;

      const { path: p } = body;

      const path = `${p}`.replace(/^\/+/, "");

      const directory = this._utils.normalizeDirectory({
        bucket,
        folder: null,
      });

      const fullPath = this._utils.normalizePath({
        directory,
        path: path,
        full: true,
      });

      if (!(await this._utils.fileExists(fullPath))) {
        return res.notFound(`No such directory or file, '${path}'`);
      }

      this._queue.add(async () => await this._utils.trashed({ path, bucket }));

      await this._utils.syncMetadata(bucket).catch((_) => null);

      return res.ok();
    } catch (err: any) {
      if (this._debug) {
        console.log(err);
      }

      return res.serverError(err.message);
    }
  };

  protected _apiConnect = async ({ res, body }: TContext) => {
    const { token, secret, bucket } = body;

    if (this._credentials != null) {
      const credentials = await this._credentials({
        token: String(token),
        secret: String(secret),
        bucket: String(bucket),
      });

      if (!credentials) {
        return res.unauthorized(
          "Invalid credentials. Please check the your credentials"
        );
      }
    }

    const directory = pathSystem.join(
      pathSystem.resolve(),
      this._utils.normalizeDirectory({ bucket: String(bucket) })
    );

    if (!(await this._utils.fileExists(directory))) {
      await fsSystem.promises.mkdir(directory, {
        recursive: true,
      });
    }

    return res.ok({
      accessToken: jwt.sign(
        {
          data: {
            issuer: "nfs-server",
            sub: {
              bucket,
              token,
            },
          },
        },
        this._jwtSecret,
        {
          expiresIn: this._jwtExipred,
          algorithm: "HS256",
        }
      ),
    });
  };

  protected _apiHealthCheck = async ({ res, headers }: TContext) => {
    const token = String(headers.authorization).split(" ")[1];

    if (token == null) {
      return res.unauthorized(
        "Please check your credentials. Are they valid ?"
      );
    }

    const payload = token.split(".")[1];

    if (payload == null || payload === "") {
      return res.unauthorized(
        "Please check your credentials. Are they valid ?"
      );
    }

    const decodedPayload = this._utils.safelyParseJSON(
      Buffer.from(payload, "base64").toString("utf-8")
    );

    if (decodedPayload.exp) {
      const currentTime = Math.floor(Date.now() / 1000);
      const timeRemaining = decodedPayload.exp - currentTime;

      if (timeRemaining > 0) {
        const days = Math.floor(timeRemaining / (24 * 60 * 60));
        const hours = Math.floor((timeRemaining % (24 * 60 * 60)) / (60 * 60));
        const minutes = Math.floor((timeRemaining % (60 * 60)) / 60);
        const seconds = timeRemaining % 60;

        return res.ok({
          iat: new Date(decodedPayload.iat * 1000),
          exp: new Date(decodedPayload.exp * 1000),
          expire: {
            days,
            hours,
            minutes,
            seconds,
          },
        });
      }

      return res.badRequest("Token has expired");
    }

    return res.badRequest("Token does not have an expiration time.");
  };

  protected _authMiddleware = (
    { req, res, headers }: TContext,
    next: TNextFunction
  ) => {
    const authorization = String(headers.authorization).split(" ")[1];

    if (authorization == null) {
      return res.unauthorized(
        "Please check your credentials. Are they valid ?"
      );
    }

    const { bucket, token } = this._verify(authorization);

    req.bucket = bucket;

    req.token = token;

    return next();
  };

  protected _authStudioMiddleware = (
    { req, res, cookies }: TContext,
    next: TNextFunction
  ) => {
    try {
      const authorization = cookies["auth.session"];

      if (authorization == null || authorization === "") {
        if (/\/studio\/api/.test(req.url || "")) {
          return res.unauthorized(
            "Please check your credentials. Are they valid ?"
          );
        }

        res.writeHead(302, { Location: "/studio" });
        return res.end();
      }

      const { buckets, token, username } = this._verify(authorization);

      req.buckets = buckets;

      req.token = token;

      req.username = username;

      return next();
    } catch (e: any) {
      if (/\/studio\/api/.test(req.url || "")) {
        return res.badRequest(e.message);
      }

      res.writeHead(302, { Location: "/studio" });
      return res.end();
    }
  };

  private _verify(token: string) {
    try {
      const decoded: any = jwt.verify(token, this._jwtSecret);

      return decoded.data.sub as {
        token: string;
        bucket: string;
        buckets: string[];
        username: string;
      };
    } catch (err: any) {
      let message = err.message;

      if (err.name === "JsonWebTokenError") {
        message = "Invalid credentials";
      }

      if (err.name === "TokenExpiredError") {
        message = "Token has expired";
      }

      const error: any = new Error(message);

      error.statusCode = 400;

      throw error;
    }
  }
}

export { NfsServerCore };
export default NfsServerCore;
