import pathSystem        from 'path'
import fsSystem          from 'fs'
import jwt               from 'jsonwebtoken'
import archiver          from 'archiver'
import { minify }        from 'html-minifier-terser'
import xml               from 'xml'
import { type TContext } from 'tspace-spear'
import { NfsServerCore } from './server.core'
import type { 
  TCredentials, 
  TLoadMonitors, 
  TLoadRequestLog, 
  TLoginCrentials, 
  TSetup 
} from '../types'
import { exec } from 'child_process'
import axios from 'axios'

class NfsStudio extends NfsServerCore {

  protected _onStudioBucketCreated    ?: ({ bucket , secret , token } : TCredentials) => Promise<void> | null
  protected _onStudioCredentials      ?: ({ username, password } : TLoginCrentials) => Promise<{ logged : boolean , buckets : string[] }> | null
  protected _onStudioLoadBucketCredentials  ?: () => Promise<TCredentials[]>;
  protected _onStudioSetup                  ?: () => TSetup
  protected _onStudioRequestLogs            ?: () => Promise<TLoadRequestLog[]>;
  protected _onStudioMonitors               ?: () => Promise<TLoadMonitors[]>

  private BASE_FOLDER_STUDIO = 'studio-html'
  private FILE_SHARE_EXPIRED = 60 * 60 * 24 * 30 // 30 days

  /**
   * The 'useStudio' is method used to wrapper to check the credentials for studio.
   * @param    {object}   studio
   * @property {function} studio.onCredentials
   * @property {function} studio.onBucketCreated
   * @returns  {this}
   */
  useStudio({
    onCredentials,
    onBucketCreated,
    onLoadBucketCredentials,
    onSetup,
    onLoadRequests,
    onLoadMonitors
  } : {
    onCredentials   : (({ username, password }: { username: string; password: string }) => Promise<{ logged: boolean; buckets: string[] }>)
    onBucketCreated ?: (({ token, secret, bucket }: { token: string; secret: string; bucket: string }) => Promise<void>),
    onLoadBucketCredentials ?: (() => Promise<{ bucket : string , token : string , secret : string}[]>),
    onSetup ?: () => TSetup
    onLoadRequests ?: () => Promise<TLoadRequestLog[]>
    onLoadMonitors ?: () => Promise<TLoadMonitors[]>
  }): this {

    this._onStudioCredentials = onCredentials
    this._onStudioBucketCreated = onBucketCreated
    this._onStudioLoadBucketCredentials = onLoadBucketCredentials
    this._onStudioSetup = onSetup
    this._onStudioRequestLogs = onLoadRequests
    this._onStudioMonitors = onLoadMonitors

    // creating file meta for any buckets
    this._utils.syncMetadata('*')
    .catch(_ => null)

    return this;
  }

  protected studio = async ({ res , cookies } : TContext) => {

    if (!fsSystem.existsSync(pathSystem.join(pathSystem.resolve(),this._rootFolder))) {
      await fsSystem.promises.mkdir(this._rootFolder, { recursive: true });
    }

    const auth = cookies['auth.session']

    const { success , data } = this._verifyToken(auth)

    if(!auth || auth == null || !success) {
      const html = await fsSystem.promises.readFile(
        pathSystem.join(__dirname, this.BASE_FOLDER_STUDIO,'login.html'), 
        'utf8'
      )

      const minifiedHtml = await minify(html, {
        collapseWhitespace: true,
        removeComments: true,
        minifyCSS: true,
        minifyJS: true
      })

      if(!success) {
        res.setHeader('Set-Cookie', 'auth.session=; HttpOnly; Max-Age=0; Path=/studio');
      }
      return res.html(this._htmlFormatted(minifiedHtml));
    }

    const html = await fsSystem.promises.readFile(pathSystem.join(__dirname, this.BASE_FOLDER_STUDIO,'index.html'), 'utf8')

    const minifiedHtml = await minify(html, {
      collapseWhitespace: true,
      removeComments: true,
      minifyCSS: true,
      minifyJS: true
    });

    return res.html(this._htmlFormatted(minifiedHtml,data.username));
  }

  protected studioStorage = async ({  req , res } : TContext) => {

    const allowBuckets : string[] = req.buckets ?? []

    const rootFolder = this._rootFolder

    const buckets = (this._buckets == null 
      ? fsSystem.readdirSync(pathSystem.join(pathSystem.resolve(),rootFolder)).filter((name) => {
        return fsSystem.statSync(pathSystem.join(rootFolder, name)).isDirectory();
      }) 
      : await this._buckets()
    ).filter((bucket : string) => allowBuckets.includes(bucket) || allowBuckets[0] === '*')


    let totalSize: number = 0;

    for(const bucket of buckets) {

      const metadata = await this._utils.getMetadata(bucket);

      if(metadata == null) continue;

      totalSize += Number(metadata.info?.size ?? 0);

    }

    return res.ok({
      buckets : buckets.length,
      storage : {
        bytes : totalSize,
        kb : Number((totalSize / 1024).toFixed(2)),
        mb : Number((totalSize / (1024 * 1024)).toFixed(2)),
        gb : Number((totalSize / (1024 * 1024 * 1024)).toFixed(2))
      }
    })

  }

  protected studioPagePreview = async ({  req, res , params } : TContext) => {

    const path = String(params['*']).replace(/^\/+/, "").replace(/\.{2}(?!\.)/g, "")
 
    const [bucket, ...rest] = String(path).split('/');

    const allowBuckets : string = req.buckets || []
    
    if(!(allowBuckets.includes(bucket) || allowBuckets[0] === '*')) {
      return res.forbidden()
    } 

    let filePath = rest.join('/')

    if(filePath != null) {
      filePath = this._utils.normalizeFolder(String(filePath))
    }

    const directory = this._utils.normalizeDirectory({ bucket , folder : null })

    if(!fsSystem.existsSync(pathSystem.join(pathSystem.resolve(),directory,filePath))) {
      return res.notFound(`The directory '${path}' does not exist`)
    }

    const extension = pathSystem.extname(filePath).replace(/\./g,'')
    
    const textFileExtensions = [
      'txt', 'md', 'csv', 'json', 'xml', 'html', 'css', 
      'js', 'ts','php','h','c', 'java','go','rs', 'py', 'sh', 'sql',
      'log', 'ini', 'bat', 'yml','yaml','key',
      'conf', 'rtf', 'tex', 'srt', 'plist', 'env',
    ];

    if(textFileExtensions.includes(extension)) {

      const html = await fsSystem.promises.readFile(pathSystem.join(__dirname, this.BASE_FOLDER_STUDIO,'vs-code.html'), 'utf8')
      
      const minifiedHtml = await minify(html, {
        collapseWhitespace: true,
        removeComments: true,
        minifyCSS: true,
        minifyJS: true
      })

      const language = {
        'ts' : 'typescript',
        'js' : 'javascript'
      }[extension] ?? extension


      const formatted = minifiedHtml
      .replace('{{language}}',language)

      return res.html(res.html(this._htmlFormatted(formatted)))
    }

    const { stream , set } = await this._utils.makeStream({
      bucket   : bucket,
      filePath : String(filePath),
      range    : req.headers?.range,
      download : true
    })

    set(res)

    return stream.pipe(res)

  }

  protected studioPreviewText = async ({  req, res , params } : TContext) => {

    const path = String(params['*']).replace(/^\/+/, "").replace(/\.{2}(?!\.)/g, "")
 
    const [bucket, ...rest] = String(path).split('/');

    const allowBuckets : string = req.buckets || []
    
    if(!(allowBuckets.includes(bucket) || allowBuckets[0] === '*')) {
      return res.forbidden()
    }
      
    let filePath = rest.join('/')

    if(filePath != null) {
      filePath = this._utils.normalizeFolder(String(filePath))
    }

    const directory = this._utils.normalizeDirectory({ bucket , folder : null })

    const fullPath = this._utils.normalizePath({ directory , path : String(filePath) , full : true })

    if(!fsSystem.existsSync(fullPath)) {
      return res.notFound(`The directory '${path}' does not exist`)
    }

    const stat = fsSystem.statSync(fullPath)

    if(stat.isDirectory()) {
      return res.badRequest('The path is a directory, cannot be read from the filesystem')
    }

    const text = await fsSystem.promises.readFile(fullPath,'utf8')

    return res.send(text);

  }

  protected studioPreviewTextEdit = async ({  req, res , params , body } : TContext) => {

    if(body.content == null) {
      return res.badRequest('Please enter a content for rewrite file')
    }
    
    const path = String(params['*']).replace(/^\/+/, "").replace(/\.{2}(?!\.)/g, "")
 
    const [bucket, ...rest] = String(path).split('/');

    const allowBuckets : string = req.buckets || []
    
    if(!(allowBuckets.includes(bucket) || allowBuckets[0] === '*')) {
      return res.forbidden()
    }
      
    let filePath = rest.join('/')

    if(filePath != null) {
      filePath = this._utils.normalizeFolder(String(filePath))
    }

    const directory = this._utils.normalizeDirectory({ bucket , folder : null })

    const fullPath = pathSystem.join(pathSystem.resolve(),directory,filePath)

    if(!fsSystem.existsSync(fullPath)) {
      return res.notFound(`The directory '${path}' does not exist`)
    }

    fsSystem.writeFileSync(fullPath , String(body.content),'utf-8')

    return res.ok()

  }

  protected studioLogin = async ({  res , body , cookies } : TContext) => {

    const MAX_ATTEMPTS = 5;
    const EXPIRED = 43_200;
    const ATTEMPTS_EXPIRED = 60;
    const JWT_SECRET = this._jwtSecret;

    if(this._onStudioCredentials == null) {
      return res.badRequest('Please enable the studio.');
    }

    const { username , password } = body

    if(!username) {
      return res.badRequest('Please enter your username.');
    }

    const cookieAttempts = cookies['auth.attempts'];

    const { success , data } = this._verifyToken(cookieAttempts);
    let count = success && username === data?.username 
      ? (data?.count ?? 0) 
      : 0

    if (count >= MAX_ATTEMPTS) {
      const start = +data?.timestamp;
      const end = +new Date();

      const diffInSeconds = Math.floor((end - start) / 1000);
      
      return res
      .status(429)
      .json({ message : `Too many login attempts. Please try again later in ${ATTEMPTS_EXPIRED - diffInSeconds}s.` });
    }

    const check = await this._onStudioCredentials({ username : String(username), password : String(password) })
    
    if(!check?.logged) {
      count = count + 1
      const attempts = jwt.sign({
        data : {
          issuer : 'nfs-studio',
          sub : {
            username,
            count,
            timestamp : +new Date()
          }
        }
      }, JWT_SECRET , { 
        expiresIn : ATTEMPTS_EXPIRED , 
        algorithm : 'HS256'
      })

      res.setHeader('Set-Cookie', `auth.attempts=${attempts}; HttpOnly; Path=/; Max-Age=60`);
      return res.unauthorized(`Authentication failed (${count}). Please check your credentials.`)
    }
    
    
    const session = jwt.sign({
      data : {
        issuer : 'nfs-studio',
        sub : {
          username,
          buckets : check?.buckets ?? [],
          permissions : ['*'],
          token  : Buffer.from(`${+new Date()}`).toString('base64')
        }
      }
    }, JWT_SECRET , { 
      expiresIn : EXPIRED , 
      algorithm : 'HS256'
    })
  
    res.setHeader('Set-Cookie',`auth.session=${session}; HttpOnly; Max-Age=${EXPIRED}; Path=/studio`)
 
    return res.ok()
  }

  protected studioLogout = async ({  res } : TContext) => {

    res.setHeader('Set-Cookie', [
      'auth.session=; HttpOnly; Max-Age=0; Path=/studio'
    ]);

    return res.ok()
  }

  protected studioUpload = async ({ req, res , files , body } : TContext) => {
    try {

      if(!Array.isArray(files?.file) || files?.file[0] == null) {
        return res.badRequest('The file is required.')
      }

      if(body.path == null || body.path === '') {
        return res.badRequest('The path is required.')
      }

      const file = files?.file[0]

      const [bucket, ...rest] = String(body.path).split('/')

      const allowBuckets : string = req.buckets || []

      if(!(allowBuckets.includes(bucket) || allowBuckets[0] === '*')) {
        return res.forbidden()
      }

      if(this._buckets != null && !(await this._buckets()).includes(bucket)) {
        return res.forbidden()
      }
      
      let folder = rest.join('/')

      if(folder != null) {
        folder = this._utils.normalizeFolder(String(folder))
      }

      const directory = this._utils.normalizeDirectory({ bucket , folder })

      if (!(await this._utils.fileExists(directory))) {

        if(this._debug) {
          console.log({ directory , bucket , folder })
        }

        await fsSystem.promises.mkdir(directory, {
          recursive: true
        })
      }

      const writeFile = (file : string , to : string) => {
        return new Promise<null>((resolve, reject) => {
          fsSystem.createReadStream(file)
          .pipe(fsSystem.createWriteStream(to))
          .on('finish', () => {
            // remove temporary from server
            this._utils.remove(file,{ delayMs : 0 })
            return resolve(null)
          })
          .on('error', (err) => reject(err));
          return 
        })
      }

      const name = `${file.name}`

      await writeFile(file.tempFilePath , this._utils.normalizePath({ directory , path : name , full : true }))

      await this._utils.syncMetadata(bucket).catch(_ => null)

      return res.ok({
        path : this._utils.normalizePath({ directory : folder , path :name }),
        name : name,
        size : file.size
      })

    } catch (err) {

      if(this._debug) {
        console.log(err)
      }

      throw err
    }
  }

  protected studioDownload = async ({ req, res , body } : TContext) => {
    try {

      const { files } = body as { files : any[]}

      if(!files?.length) {

        return res.badRequest('Please specify which files to download.')
      }

      const items = files.map(v => {
        return {
          ...v,
          path : this._utils.normalizePath({ directory : this._rootFolder, path : String(v.path) , full : true })
        }
      })
      
      const archive = archiver('zip', { zlib: { level: 1 }});

      archive.on('error', err => {
        console.log(err)
        return res.serverError('Error during archive');
      });

      res.setHeader('Content-Disposition', `attachment; filename="download_${+new Date()}.zip"`);
      res.setHeader('Content-Type', 'application/zip');

      archive.pipe(res)
      
      for (const item of items) {
        if (item.isFolder) {
          archive.directory(item.path, item.name);
          continue
        } 
       
        archive.file(item.path, { name: item.name });
      }
      
      return await archive.finalize();

    } catch (err) {

      if(this._debug) {
        console.log(err)
      }

      throw err
    }
  }

  protected studioBucket = async ({ req , res } : TContext) => {
   
    const allowBuckets : string[] = req.buckets ?? []

    const rootFolder = this._rootFolder

    const buckets = (this._buckets == null 
      ? fsSystem.readdirSync(pathSystem.join(pathSystem.resolve(),rootFolder)).filter((name) => {
        return fsSystem.statSync(pathSystem.join(rootFolder, name)).isDirectory();
      }) 
      : await this._buckets()
    ).filter((bucket : string) => allowBuckets.includes(bucket) || allowBuckets[0] === '*')

    const lists : any[] = []

    for(const bucket of buckets) {

      if(allowBuckets.includes(bucket) || allowBuckets[0] === '*') {

        const fullPath = pathSystem.join(pathSystem.resolve(),this._rootFolder,bucket)

        if(!(await this._utils.fileExists(fullPath))) {
          await fsSystem.promises.mkdir(fullPath, {
            recursive: true
          })

          if(this._onStudioBucketCreated != null) {
            const random  = () => Array.from({ length: 5 }, (_,i) => i).map(v => Math.random().toString(36).substring(3)).join('')
            await this._onStudioBucketCreated({
              bucket : String(bucket),
              token : String(random()),
              secret : String(random())
            })
          }
        }

        const loadCredentials = this._onStudioLoadBucketCredentials == null ? [] : await this._onStudioLoadBucketCredentials();

        const credentials = loadCredentials.find(v => v.bucket === bucket);

        const bytes = Number((await this._utils.getMetadata(bucket))?.info?.size ?? 0);

        lists.push({
          [bucket] : {
            credentials,
            storage :  {
              bytes,
              kb : Number((bytes / 1024).toFixed(2)),
              mb : Number((bytes / (1024 * 1024)).toFixed(2)),
              gb : Number((bytes / (1024 * 1024 * 1024)).toFixed(2))
            }
          }
        })
      }
    }

    return res.ok({
      buckets : lists
    })
  }

  protected studioBucketCreate = async ({ req , res , body } : TContext) => {

    const { bucket , token , secret } = body

    if([bucket].some(v => v == null || v ==='')) {
      return res.badRequest('The bucket is required.')
    }

    const buckets : string[] = (this._buckets == null ? [] :await  this._buckets())
    
    if(buckets.some(v => v === bucket)) {
      return res.badRequest('The bucket already exists.')
    }
   
    const directory = this._utils.normalizeDirectory({ bucket : String(bucket) , folder : null })

    if(!(await this._utils.fileExists(directory))) {
      await fsSystem.promises.mkdir(directory, {
        recursive: true
      })
    }

    const randomString = (length = 8) => Math.random().toString(36).substr(2, length)

    if(this._onStudioBucketCreated != null) {
      await this._onStudioBucketCreated({
        bucket : String(bucket),
        token :  String(token == null  || token === '' ? randomString() : token),
        secret : String(secret == null || secret === '' ? randomString() : secret),
      })
    }
    
    return res.ok()

  }

  protected studioFiles = async ({ req, res , params } : TContext) => {
   
    const rootFolder = this._rootFolder

    const path = String(params['*']).replace(/^\/+/, "").replace(/\.{2}(?!\.)/g, "")

    const [bucket] = String(path).split('/')

    const allowBuckets : string = req.buckets || []
    
    if(!(allowBuckets.includes(bucket) || allowBuckets[0] === '*')) {
      return res.forbidden()
    }

    const targetDir = `${rootFolder}/${path}`

    if(!fsSystem.existsSync(pathSystem.join(pathSystem.resolve(),targetDir))) {
      return res.notFound(`The directory '${path}' does not exist`)
    }

    const files = await this._utils.fileStructure(targetDir , { includeFiles : true , bucket })
    
    return res.ok({
      files : files.sort((a, b) => {

        if (a.name.includes('@') && !b.name.includes('@')) {
          return -1;
        }
        if (!a.name.includes('@') && b.name.includes('@')) {
          return 1;
        }
      
        if (a.isFolder !== b.isFolder) {
          return b.isFolder - a.isFolder;
        }
  
        return +new Date(a.lastModified) - +new Date(b.lastModified);
      })
    })
      
  }

  protected studioEdit = async ({ req, res , params , body } : TContext) => {
   
    const path = String(params['*']).replace(/^\/+/, "").replace(/\.{2}(?!\.)/g, "")
 
    const [bucket, ...rest] = String(path).split('/');

    const allowBuckets : string = req.buckets || []
    
    if(!(allowBuckets.includes(bucket) || allowBuckets[0] === '*')) {
      return res.forbidden()
    }

    const { rename } = body

    if(rename == null || rename === '') {
      return res.badRequest('Please enter the name you wish to use.')
    }
      
    let filePath = rest.join('/')

    if(filePath != null) {
      filePath = this._utils.normalizeFolder(String(filePath))
    }

    const oldPath = this._utils.normalizeDirectory({ bucket , folder : filePath })

    if(!fsSystem.existsSync(pathSystem.join(pathSystem.resolve(),oldPath))) return res.notFound()

    const newPath = this._utils.normalizeDirectory({ 
      bucket , 
      folder : `${pathSystem.dirname(filePath)}/${rename}${pathSystem.extname(filePath)}`
    })

    fsSystem.renameSync(
      pathSystem.join(pathSystem.resolve(),oldPath),
      pathSystem.join(pathSystem.resolve(),newPath),
    );

    return res.ok({
      name : rename
    })
      
  }

  protected studioRemove = async ({ req, res , body , params } : TContext) => {
   
    const data = String(params['*']).replace(/^\/+/, "").replace(/\.{2}(?!\.)/g, "")
 
    const [bucket, ...rest] = String(data).split('/');

    const path = rest.join('/')

    const allowBuckets : string = req.buckets || []
    
    if(!(allowBuckets.includes(bucket) || allowBuckets[0] === '*')) {
      return res.forbidden()
    }

    const filePath = this._utils.normalizeFolder(String(path))

    const fullPath = pathSystem.join(pathSystem.resolve(),this._utils.normalizeDirectory({ bucket , folder : filePath }))

    if(!fsSystem.existsSync(fullPath)) return res.notFound()

    const stats = fsSystem.statSync(fullPath) 

    if (stats.isDirectory()) {

      if(path.includes(this._trash)) {
        fsSystem.rmSync(fullPath, { recursive: true, force: true })
        return res.ok()
      }

      this._queue.add(async () => await this._utils.trashedWithFolder({ path , bucket  }))

      return res.ok()
    }

    if(path.includes(this._trash)) {
      this._utils.remove(fullPath , { delayMs : 0 })
      await this._utils.syncMetadata(bucket).catch(_ => null)
      return res.ok()
    }

    this._queue.add(async () => await this._utils.trashed({ path , bucket  }))

    return res.ok()
      
  }

  protected studioGetPathShared = async ({  req, res , params } : TContext) => {

    const path = String(params['*']).replace(/^\/+/, "").replace(/\.{2}(?!\.)/g, "")
 
    const [bucket, ...rest] = String(path).split('/');

    const allowBuckets : string = req.buckets || []
    
    if(!(allowBuckets.includes(bucket) || allowBuckets[0] === '*')) {
      return res.forbidden()
    } 

    let filePath = rest.join('/')

    if(filePath != null) {
      filePath = this._utils.normalizeFolder(String(filePath))
    }

    const directory = this._utils.normalizeDirectory({ bucket , folder : null })

    if(!fsSystem.existsSync(pathSystem.join(pathSystem.resolve(),directory,filePath))) {
      return res.notFound(`The directory '${path}' does not exist`)
    }

    const token = jwt.sign({
      data : {
        issuer : 'nfs-studio',
        sub : {
          name : filePath
        }
      }
    }, this._jwtSecret , { 
      expiresIn : this.FILE_SHARE_EXPIRED, 
      algorithm : 'HS256'
    })

     return res.ok({
      path : `studio/shared/${path}?key=${token}`
    })
  }

  protected studioPageShared = async ({  req, res , params , query } : TContext) => {

    const path = String(params['*']).replace(/^\/+/, "").replace(/\.{2}(?!\.)/g, "")
 
    const [bucket, ...rest] = String(path).split('/');

    const token = query.key;

    if(token == null || token ==='') {
      res.writeHead(400 , { 'Content-Type': 'text/xml'})
      
      const error = {
        Error : [
            { Code : 'BadRequest' },
            { Message : 'The key is required?'},
            { Resource : req.url },
        ]
      }

      return res.end(xml([error],{ declaration: true }))
    }

    let filePath = rest.join('/')

    if(filePath != null) {
      filePath = this._utils.normalizeFolder(String(filePath))
    }

    const { success, data } = this._verifyToken(token)

    if(!success || data.name !== filePath) {
      res.writeHead(400 , { 'Content-Type': 'text/xml'})
      
      const error = {
        Error : [
          { Code : 'BadRequest' },
          { Message : !success ? data :'The request was denied by studio, Please check key is valid?'},
          { Resource : req.url },
        ]
      }

      return res.end(xml([error],{ declaration: true }))
    }

    const directory = this._utils.normalizeDirectory({ bucket , folder : null })

    if(!fsSystem.existsSync(pathSystem.join(pathSystem.resolve(),directory,filePath))) {
      return res.notFound(`The directory '${path}' does not exist`)
    }

    const { stream , set } = await this._utils.makeStream({
      bucket   : bucket,
      filePath : String(filePath),
      range    : req.headers?.range,
      download : true
    })

    set(res)
    
    return stream.pipe(res)

  }

  protected studioPageDashboard = async ({  req, res , params , query } : TContext) => {

    const html = await fsSystem.promises.readFile(pathSystem.join(__dirname, this.BASE_FOLDER_STUDIO,'dashboard.html'), 'utf8')

    const minifiedHtml = await minify(html, {
      collapseWhitespace: true,
      removeComments: true,
      minifyCSS: true,
      minifyJS: true
    });

    return res.html(this._htmlFormatted(minifiedHtml));

  }

  protected studioLogRequest = async ({  res , body , cookies } : TContext) => {

    if(this._onStudioRequestLogs == null) {
      return res.badRequest('Please enable the studio.');
    }

    return res.ok({
      requests : await this._onStudioRequestLogs()
    })
  }

  protected studioLogMonitors = async ({  res , body , cookies } : TContext) => {

    if(this._onStudioMonitors == null) {
      return res.badRequest('Please enable the studio.');
    }

    return res.ok({
      requests : await this._onStudioMonitors()
    })
  }

  protected studioConsoleLogs = async ({ req, query,  res , params, cookies } : TContext) => {

    const MAX_RETRY = 8;
    const rawTail = String(query.tail ?? "200");

    let tail = parseInt(rawTail, 10);

    if (isNaN(tail) || tail < 1 || tail > 100_000) {
      tail = 200;
    }
    
    const cid = params['cid'];
    const id = this._utils.getContainerId();
   
    res.setHeader('Content-Type', 'text/plain');

    if(cid == null || cid === '') {
      res.statusCode = 400;
      return res.end(`The 'cid' parameter is required.`);
    }

    if(id == null || id === '') {
      res.statusCode = 400;
      return res.end(`The future is supported only docker`);
    }

    // try again because load balancer send request to other node
    if((id !== cid)) {
      let retry = Number(query.retry ? Number(query.retry) - 1 : MAX_RETRY);
      retry = Number.isNaN(retry) ? MAX_RETRY : retry;

      if(retry < 0) {
        res.statusCode = 400;
        return res.end("");
      }

      const protocol = req.headers['x-forwarded-proto'] || 'http';
      const url = `${protocol}://${req.headers.host}/studio/api/logs/console/${cid}?tail=${tail}&retry=${retry}`;
      const authorization = cookies["auth.session"];

      const { data } = await axios.get(url, {
        responseType: 'text',
        headers: {
          Cookie: `auth.session=${authorization}`
        }
      }).catch(() => ({ data: '' }));

      if(data === '') {
        res.statusCode = 400;
        return res.end("");
      };

      res.statusCode = 200;
      return res.end(data);
    }

    // next step logs in k8s
    const command = `docker logs --tail ${tail} ${cid}`;
    
    exec(command, { maxBuffer: 1024 * 1024 * 10 }, (err, stdout, stderr) => {
      if (err) {
        res.statusCode = 400;
        return res.end(`${stderr || err.message}`.replace('\n',''));
      }
      res.statusCode = 200;
      return res.end(stdout ? stdout.toString() : "");
    });
  }

  protected studioPageConsoleLogs = async ({  res } : TContext) => {

    const html = await fsSystem.promises.readFile(pathSystem.join(__dirname, this.BASE_FOLDER_STUDIO,'console.html'), 'utf8')

    const minifiedHtml = await minify(html, {
      collapseWhitespace: true,
      removeComments: true,
      minifyCSS: true,
      minifyJS: true
    });

    return res.html(this._htmlFormatted(minifiedHtml));
    
  }

  private _verifyToken (token : string) {
  
      try {
       
        const decoded : any = jwt.verify(token, this._jwtSecret)
    
        return {
          success : true,
          data : decoded.data.sub as { name : string }
        }
    
      } catch (err:any) {
  
        let message = err.message

        if (err.name === 'JsonWebTokenError') {
          message = 'Invalid credentials'
        } 
        
        if (err.name === 'TokenExpiredError') {
          message = 'Token has expired'
        } 

        return {
          success : false,
          data : message
        }

      }
  }

  private _htmlFormatted = ( html : string,username ?: string | null) => {
    const setup = this._onStudioSetup == null ? {} : this._onStudioSetup()
    return String(html)
    .replace('{{auth.username}}',username == null || username === '' ? 'N' : username.charAt(0).toUpperCase())
    .replace('{{name}}',setup?.name ?? 'NFS-Studio')
    .replace('{{title}}',setup?.title ?? 'NFS-Studio')
    .replace('{{subtitle}}',setup?.subtitle ?? '')
    .replace('{{description}}',setup?.description ?? '')
    .replace('{{logo.login}}',setup?.logo?.login ?? '') 
    .replace('{{logo.fav}}',setup?.logo?.fav ?? '') 
    .replace('{{logo.index}}',setup?.logo?.index ?? `
      <svg class="w-12 h-12 text-gray-800 dark:text-white" aria-hidden="true" xmlns="http://www.w3.org/2000/svg" width="24" height="24" fill="none" viewBox="0 0 24 24">
        <path stroke="currentColor" stroke-linejoin="round" stroke-width="2" d="M15 4v3a1 1 0 0 1-1 1h-3m2 10v1a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-7.13a1 1 0 0 1 .24-.65L6.7 8.35A1 1 0 0 1 7.46 8H9m-1 4H4m16-7v10a1 1 0 0 1-1 1h-7a1 1 0 0 1-1-1V7.87a1 1 0 0 1 .24-.65l2.46-2.87a1 1 0 0 1 .76-.35H19a1 1 0 0 1 1 1Z"/>
      </svg>
    `) 
  }
}

export { NfsStudio }
export default NfsStudio