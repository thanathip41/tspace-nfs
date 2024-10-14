import pathSystem   from 'path'
import fsSystem     from 'fs'
import jwt          from 'jsonwebtoken'
import xml          from 'xml'
import bcrypt       from 'bcrypt'
import cron         from 'node-cron'
import { Server }   from 'http'
import { Time }     from 'tspace-utils'
import { 
  type TContext, 
  type TNextFunction,
  Application,
  Router
} from 'tspace-spear'
import Queue from './queue'
import html  from './default-html'
/**
 * The 'NfsServer' class is a created the server for nfs
 * 
 * @example
 * import { NfsServer } from "tspace-nfs";
 *
 * new NfsServer()
 * .listen(8000 , ({ port }) => console.log(`Server is running on port http://localhost:${port}`))
 */
class NfsServer {

  private _queue          = new Queue(3)
  private _app            !: Application 
  private _router         !: Router 
  private _html           !: string | null
  private _credentials    !: ({ token , secret , bucket } : { token : string; secret : string; bucket : string}) => Promise<boolean> | null
  private _buckets        !: Function | null
  private _studioCheck    !: ({ username, password } : { username : string; password : string }) => Promise<{ logged : boolean , buckets : string[] }> | null
  private _fileExpired    : number = 60 * 60
  private _rootFolder     : string = 'nfs'
  private _cluster        : boolean | number = false
  private _jwtExipred     : number = 60 * 60
  private _jwtSecret      : string = `<secret@${+new Date()}:${Math.floor(Math.random() * 9999)}>`
  private _progress       : boolean = false
  private _debug          : boolean = false
  private _trash          : string = '@trash'
  private _backup         : number = 30

  get instance () {
    return this._app
  }

  /**
   * The 'progress' is method used to view the progress of the file upload.
   * 
   * @returns {this}
   */
  debug(): this {

    this._debug = true

    return this
  }

  /**
   * The 'progress' is method used to view the progress of the file upload.
   * 
   * @returns {this}
   */
  progress (): this {

    this._progress = true

    return this
  }

  /**
   * The 'defaultPage' is method used to set default home page.
   * 
   * @param {string} html 
   * @returns {this}
   */
  defaultPage (html : string): this {
    this._html = html
    return this
  }

  /**
   * The 'directory' is method used to set directory for root directory
   * 
   * @param {string} folder 
   * @returns {this}
   */
  directory(folder : string): this {

    this._rootFolder = folder

    return this
  }

  /**
   * The 'cluster' is method used to make cluster for server
   * 
   * @param {number} workers
   * @returns {this}
   */
  cluster (workers ?: number): this {

    this._cluster = workers == null ? true : workers

    return this
  }

  /**
   * The 'fileExpired' is method used to set file expiration
   * 
   * @param {number} seconds 
   * @returns {this}
   */
  fileExpired (seconds  : number): this {
    this._fileExpired = seconds 
    return this
  }

  /**
   * The 'credentials' is method used to set expiration and secret for credentials
   * 
   * @param    {object}  credentials
   * @property {number}  credentials.expired by seconds
   * @property {string?} credentials.secret 
   * @returns  {this}
   */
  credentials ({ expired , secret } : { expired : number , secret ?: string}): this {

    this._jwtExipred = expired

    if(secret) {
      this._jwtSecret = secret
    }

    return this
  }

  /**
   * The 'bucketLists' method is used to inform the server about the available bucket lists.
   * 
   * @param    {function} callback
   * @returns  {this}
   */
  bucketLists (callback : () => Promise<string[]>) : this {

    this._buckets = callback

    return this

  } 

  /**
   * The 'onCredentials' is method used to wrapper to check the credentials.
   * 
   * @param    {function} callback
   * @returns  {this}
   */
  onCredentials (callback : ({ token , secret , bucket } : { token : string; secret : string; bucket : string}) => Promise<boolean>) : this {

    this._credentials = callback

    return this

  } 

  /**
   * The 'onStudioCredentials' is method used to wrapper to check the credentials for studio.
   * 
   * @param    {function} callback
   * @returns  {this}
   */
  onStudioCredentials (callback : ({ username, password } : { username : string; password : string }) => Promise<{ logged : boolean , buckets : string[] }>) : this {

    this._studioCheck = callback

    return this

  } 

  /**
   * The 'listen' method is used to bind and start a server to a particular port and optionally a hostname.
   * 
   * @param {number} port 
   * @param {function} cb
   * @returns 
   */
  listen(port:number, cb ?: ({port , server} : { port : number , server : Server }) => void) {

    cron.schedule('0 0 0 * * *', async () => {

      if(this._buckets == null) return

      const buckets : string[] = await this._buckets()
      
      for(const bucket of buckets) {
        this._queue.add(() => this._removeOldDirInTrash(bucket))
      }
    })

    this._app = new Application({
      cluster : this._cluster
    })

    this._app.cors()

    this._app.useLogger({
      exceptPath  : /\/benchmark(\/|$)|\/favicon\.ico(\/|$)/
    })

    this._app.useBodyParser()

    this._app.useCookiesParser()
    
    this._app.useFileUpload({
      limit : Infinity,
      tempFileDir : 'tmp',
      removeTempFile : {
        remove : true,
        ms : 1000 * 60 * 60 * 2
      }
    })

    this._router = new Router()

    this._router.get('/' , this._default)
    
    this._router.get('/benchmark',this._benchmark)

    this._router.groups('/api' , (router) => {
      router.post('/connect', this._apiConnect)
      router.post('/storage', this._authMiddleware ,this._apiStorage)
      router.post('/file',    this._authMiddleware ,this._apiFile)
      router.post('/folders', this._authMiddleware ,this._apiFolders)
      router.post('/base64',  this._authMiddleware ,this._apiBase64)
      router.post('/stream',  this._authMiddleware ,this._apiStream)
      router.post('/remove',  this._authMiddleware ,this._apiRemove)
      router.post('/upload',  this._authMiddleware ,this._apiUpload)
      router.post('/upload/merge',  this._authMiddleware ,this._apiMerge)
      router.post('/upload/base64', this._authMiddleware ,this._apiUploadBase64)
      return router
    })

    if(this._studioCheck != null) {
      this._router.groups('/studio' , (router) => {
        router.get('/' , this._studio)
        router.post('/api/login',this._studioLogin)
        router.get('/preview/*', this._authStudioMiddleware,this._studioPreview)
        router.delete('/api/logout',this._authStudioMiddleware,this._studioLogout)
        router.get('/api/buckets',this._authStudioMiddleware,this._studioBucket)
        router.get('/api/files/*',this._authStudioMiddleware,this._studioFiles)
        router.put('/api/files/*', this._authStudioMiddleware,this._studioEdit)
        router.delete('/api/files/*', this._authStudioMiddleware,this._studioRemove)
        router.post('/api/upload',this._authStudioMiddleware,this._studioUpload)

        return router
      })
    }
   
    this._router.get('/:bucket/*' , this._media)

    this._app.useRouter(this._router)

    this._app.notfound(({  req , res }) => {

      res.writeHead(404 , { 'Content-Type': 'text/xml'})

      const error = {
        Error : [
            { Code : 'Not found' },
            { Message : 'The request was invalid'},
            { Resource : req.url },
        ]
      }

      return res.end(xml([error],{ declaration: true }))
    })

    this._app.response((results : any , statusCode : number) => {

      if(typeof results === 'string') return results
    
      return {
        success : statusCode < 400,
        ...results,
        statusCode
      }
    })

    this._app.catch((err : Error , { req , res } : TContext) => {

      if(this._debug) {
        console.log(err)
      }

      return res.status(500)
      .json({
        message : err.message
      })
    })

    this._app.listen(port, ({ port , server }) => {
      return cb == null ? null : cb({ port , server })
    })
  }

  private _default = async ({ res } : TContext) => {
    return res.html(this._html == null ? html : String(this._html));
  }

  private _benchmark = () => {
    return 'benchmark in nfs server'
  }
  
  private _media = async ({ req , res , query , params } : TContext) => {
      try {

        const { 
          AccessKey , 
          Expires , 
          Signature , 
          Download
        } = query as { 
          AccessKey : string, 
          Expires : string, 
          Signature : string,
          Download : string
        }

        const bucket = params.bucket
      
        if([
          AccessKey , Expires , Signature , Download , bucket
        ].some(v => v === '' || v == null)) {
          
          res.writeHead(400 , { 'Content-Type': 'text/xml'})
          const error = {
              Error : [
                  { Code : 'Bad request' },
                  { Message : 'The request was invalid'},
                  { Resource : req.url },
                  { RequestKey : query?.key }
              ]
          }
  
          return res.end(xml([error],{ declaration: true }))
        }

        const path     = String(params['*']).replace(/^\/+/, '').replace(/\.{2}(?!\.)/g, "")
        const combined = `@{${path}-${bucket}-${AccessKey}-${Expires}-${Download}}`
        const compare  = bcrypt.compareSync(combined, Buffer.from(Signature,'base64').toString('utf-8'))
        const expired  = Number.isNaN(+Expires) ? true : new Date(+Expires) < new Date() 

        if(!compare || expired) {
            
            res.writeHead(400 , { 'Content-Type': 'text/xml'})

            const error = {
                Error : [
                    { Code : expired  ? 'Expired' : 'AccessDenied' },
                    { Message : expired  ? 'Request has expired' : 'The signature is not correct'},
                    { Resource : req.url },
                    { RequestKey : query.key }
                ]
            }
  
            return res.end(xml([error],{ declaration: true }))
        }
  
        const { stream , header , set } = await this._makeStream({
          bucket   : bucket,
          filePath : String(path) ,
          range    : req.headers?.range,
          download : Download === Buffer.from(`${Expires}@true`).toString('base64').replace(/[=|?|&]+$/g, '')
        })
  
        if(stream == null || header == null) {
  
            res.writeHead(404 , { 'Content-Type': 'text/xml'})
  
            const error = {
              Error : [
                { Code : 'Not found' },
                { Message : 'The file does not exist in our records' },
                { Resource : req.url },
                { RequestKey : query.key }
              ]
            }

            return res.end(xml([error],{ declaration: true }))
        }
  
        set(res)
        
        return stream.pipe(res);
  
    } catch (err:any) {
        res.writeHead(400 , { 'Content-Type': 'text/xml'})
  
        const error = {
          Error : [
                { Code : 'AccessDenied' },
                { Message : err.message },
                { Resource : req.url },
                { RequestKey : query.key }
            ]
        }
  
        return res.end(xml([error],{ declaration: true }))
    }
  }

  private _apiFile =  async ({ req , res , body } : TContext) => {
    try {
  
      const { bucket , token } = req

      let { path , download , expired } = body

      const fileName = `${path}`.replace(/^\/+/, '')

      const directory = this._normalizeDirectory({ bucket , folder : null })

      const fullPath = this._normalizePath({ directory , path : String(path) , full : true })

      if(!(await this._fileExists(fullPath))) {

        if(this._debug) {
          console.log({
            fullPath,
            path,
            download,
            expired
          })
        }

        return res.status(404).json({
          message : `No such directory or file, '${fileName}'`
        })
      }
  
      const key        = String(token)
      const expires    = new Time().addSeconds(expired == null || Number.isNaN(Number(expired)) ? this._fileExpired : Number(expired)).toTimeStamp()
      const downloaded = `${Buffer.from(`${expires}@${download}`).toString('base64').replace(/[=|?|&]+$/g, '')}`
      const combined   = `@{${path}-${bucket}-${key}-${expires}-${downloaded}}`
      const signature  = Buffer.from(bcrypt.hashSync(combined , 1)).toString('base64')
  
      return res.ok({
        endpoint : [
          `${bucket}/${fileName}?AccessKey=${key}`,
          `Expires=${expires}`,
          `Download=${downloaded}`,
          `Signature=${signature}`
        ].join('&')
      })
  
    } catch (err : any) {

      if(this._debug) {
        console.log(err)
      }

      return res.status(500)
      .json({
        message : err.message
      })
    }
  }

  private _apiBase64 =  async ({  req, res , body } : TContext) => {
    try {
  
      const { bucket } = req

      const { path : filename } = body

      const directory = this._normalizeDirectory({ bucket , folder : null })

      const path = this._normalizePath({ directory , path : String(filename) , full : true})
  
      if(!(await this._fileExists(path))) {
        return res.status(404).json({
          message : `no such file or directory, '${filename}'`
        })
      }
  
      return res.json({
        base64 : fsSystem.readFileSync(path, 'base64')
      })
  
    } catch (err : any) {

      if(this._debug) {
        console.log(err)
      }

      return res.status(500).json({
        message : err.message
      })
    }
  }

  private _apiStream = async ({ req , res , body } : TContext) => {

    try {

      const { bucket } = req

      const { path : filename , range } = body

      const directory = this._normalizeDirectory({ bucket , folder : null })

      const fullPath = this._normalizePath({ directory , path : String(filename) , full : true})
      
      if(!(await this._fileExists(fullPath))) {
        return res.status(404).json({
          message : `no such file or directory, '${filename}'`
        })
      }

      const stat = fsSystem.statSync(fullPath)
      const fileSize = stat.size;
    
      if (range) {
        const parts = String(range).replace(/bytes=/, "").split("-");
        const start = parseInt(parts[0], 10);
        const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
        const chunksize = (end - start) + 1;
        const file = fsSystem.createReadStream(fullPath, { start, end });
        const head = {
          'Content-Range': `bytes ${start}-${end}/${fileSize}`,
          'Accept-Ranges': 'bytes',
          'Content-Length': chunksize,
          'Content-Type': 'video/mp4',
        };
        res.writeHead(206, head);
        return file.pipe(res);
      } 

      const head = {
        'Content-Length': fileSize,
        'Content-Type': 'video/mp4',
      };
      res.writeHead(200, head);

      return fsSystem.createReadStream(fullPath).pipe(res);

    } catch (err) {

      if(this._debug) {
        console.log(err)
      }

      throw err

    }
    
  }

  private _apiStorage =  async ({ req, res , body } : TContext) => {
    try {
  
      const { bucket } = req

      let { folder } = body

      if(folder != null) {
        folder = this._normalizeFolder(String(folder))
      }
   
      const directory = this._normalizeDirectory({ bucket , folder })

      if(!(await this._fileExists(directory))) {
        return res.status(404).json({
          message : `No such directory or folder, '${folder}'`
        })
      }
  
      const fileDirectories = await this._files(directory , { ignore : this._trash })

      const storage = fileDirectories.map((name) => {
        const stat = fsSystem.statSync(name)
        return {
          name :  pathSystem.relative(directory, name).replace(/\\/g, '/'),
          size : Number((stat.size / (1024 * 1024))) 
        }
      })

      return res.ok({
        storage
      })
  
    } catch (err : any) {

      if(this._debug) {
        console.log(err)
      }

      return res.status(500).json({
        message : err.message
      })
    }
  }

  private _apiFolders =  async ({ req, res } : TContext) => {

    try {
  
      const { bucket } = req

      const directory = this._normalizeDirectory({ bucket , folder : null })

      const folders = fsSystem.readdirSync(directory)

      return res.ok({
        folders
      })
  
    } catch (err : any) {

      if(this._debug) {
        console.log(err)
      }

      return res.status(500).json({
        message : err.message
      })
    }
  }

  private _apiUpload = async ({ req , res , files , body } : TContext) => {
    try {

      const { bucket } = req

      if(!Array.isArray(files?.file)) {
        return res.status(400).json({
          message : 'The file is required.'
        })
      }

      const file = files?.file[0]

      if (file == null) {
        return res.status(400).json({
          message : 'The file is required.'
        })
      }

      let { folder } = body
    
      if(folder != null) {
        folder = this._normalizeFolder(String(folder))
      }

      const directory = this._normalizeDirectory({ bucket , folder })

      if (!(await this._fileExists(directory))) {

        if(this._debug) {
          console.log({ directory , bucket , folder })
        }

        fsSystem.mkdirSync(directory, {
          recursive: true
        })
      }

      const writeFile = (file : string , to : string) => {
        return new Promise<null>((resolve, reject) => {
          fsSystem.createReadStream(file)
          .pipe(fsSystem.createWriteStream(to))
          .on('finish', () => {
            this._remove(to)
            this._remove(file,{ delayMs : 0 })
            return resolve(null)
          })
          .on('error', (err) => reject(err));
          return 
        })
      }
      

      await writeFile(file.tempFilePath , this._normalizePath({ directory , path : file.name , full : true }))

      return res.ok({
        path : this._normalizePath({ directory : folder , path : file.name }),
        name : file.name,
        size : file.size
      })

    } catch (err) {

      if(this._debug) {
        console.log(err)
      }

      throw err
    }
  }

  private _apiMerge = async ({ req , res , body } : TContext) => {
  
    try {

      const { bucket } = req

      let { 
        folder, 
        name,
        paths,
        totalSize
      } = body as {
        folder ?: string | null
        name : string
        paths : string[]
        totalSize : number
      }

      if(folder != null) {
        folder = this._normalizeFolder(String(folder))
      }

      const directory = this._normalizeDirectory({ bucket , folder })

      if (!(await this._fileExists(directory))) {
        fsSystem.mkdirSync(directory, {
          recursive: true
        })
      }

      const writeFile = async (to : string) => {

        return new Promise((resolve, reject) => {

          const writeStream = fsSystem.createWriteStream(to , { flags : 'a' })

          writeStream.on('error', (err) => {
            return reject(err)
          })

          let processedSize = 0
        
          const next = (index : number = 0) => {

            if (index >= paths.length) {
              
              writeStream.end()

              writeStream.close()

              return resolve(null)
            }

            const partPath = this._normalizePath({
              directory,
              path : paths[index],
              full: true
            })

            const readStream = fsSystem.createReadStream(partPath , { 
              highWaterMark : 1024 * 1024 * 100
            })
    
            if(this._progress) {
              readStream.on('data', (chunk : string) => {
                processedSize += chunk.length
                const progress = ((processedSize / totalSize) * 100).toFixed(2);
                console.log(`The file '${pathSystem.basename(to)}' in progress: ${progress}%`)
              })
            }
            
            readStream.on('error', (err) => {
              return reject(err);
            })
      
            readStream.on('end', () => {
              this._remove(partPath,{ delayMs : 0 })
              next(index + 1)
            })

            readStream.pipe(writeStream, { end: false })
          }

          next()
        })
      }

      const to = this._normalizePath({ directory , path : name , full : true })
      
      await writeFile(to)

      return res.ok({
        path : this._normalizePath({ directory : folder , path : name }),
        name : name,
        size : fsSystem.statSync(to).size
      })

    } catch (err) {

      if(this._debug) {
        console.log(err)
      }

      throw err

    }
  }

  private _apiUploadBase64 = async ({ req, res, body  } : TContext) => {
  
    try {

      const { bucket } = req

      let { folder , base64 , name } = body

      if(folder != null) {
        folder = this._normalizeFolder(String(folder))
      }

      if(base64 === '' || base64 == null) {
        return res.status(400).json({
          message : 'The base64 is required.'
        })
      }

      if(name === '' || name == null) {
        return res.status(400).json({
          message : 'The name is required.'
        })
      }
    
      const directory = this._normalizeDirectory({ bucket , folder})

      if (!(await this._fileExists(directory))) {
        fsSystem.mkdirSync(directory, {
          recursive: true
        })
      }

      const writeFile = (base64 : string , to : string) => {
        return fsSystem.writeFileSync(to, String(base64), 'base64')
      }

      const to = pathSystem.join(pathSystem.resolve(),`${directory}/${name}`)

      writeFile(String(base64), to)

      return res.ok({
        path : folder ? `${folder}/${name}` : name,
        name : name,
        size : fsSystem.statSync(to).size
      })
    } catch (err) {

      if(this._debug) {
        console.log(err)
      }

      throw err

    }
  }

  private _apiRemove =  async ({ req, res , body } : TContext) => {
    try {
  
      const { bucket } = req

      const { path : p } = body

      const filename = `${p}`.replace(/^\/+/, '')

      const directory = this._normalizeDirectory({ bucket , folder : null })
      
      const path = this._normalizePath({ directory , path : filename , full : true})
     
      if(!(await this._fileExists(path))) {
        return res.status(404)
        .json({
          message : `No such directory or file, '${filename}'`
        })
      }

      this._queue.add(async () => await this._trashed({ path, bucket , filename }))
      
      return res.ok()
  
    } catch (err : any) {

      if(this._debug) {
        console.log(err)
      }

      return res.status(500).json({
        message : err.message
      })
    }
  }

  private _apiConnect = async ({ res , body } : TContext) => {
  
    const { token , secret , bucket } = body

    if(this._credentials != null) {

      const credentials = await this._credentials({ 
        token  : String(token),
        secret : String(secret),
        bucket : String(bucket)
      })

      if(!credentials) {
        return res.status(401).json({
          message : 'Invalid credentials. Please check the your credentials'
        })
      }
    }

    const directory = pathSystem.join(pathSystem.resolve(), this._normalizeDirectory({ bucket : String(bucket) }))
      
    if(!(await this._fileExists(directory))) {
      fsSystem.mkdirSync(directory, {
        recursive: true
      })
    }

    return res.json({
      accessToken : jwt.sign({
        data : {
          issuer : 'nfs-server',
          sub : {
            bucket,
            token
          }
        }
      }, this._jwtSecret , { 
        expiresIn : this._jwtExipred , 
        algorithm : 'HS256'
      })
    })
  }

  private _studio = async ({  res , cookies } : TContext) => {

    const auth = cookies['auth.session']

    if(!auth) {
      const html = fsSystem.readFileSync(pathSystem.join(__dirname, 'studio','login.html'), 'utf8');
   
      return res.html(html);
    }
    const html = fsSystem.readFileSync(pathSystem.join(__dirname, 'studio','index.html'), 'utf8');
   
    return res.html(html);
  }

  private _studioPreview = async ({  req, res , params } : TContext) => {

    const path = String(params['*']).replace(/^\/+/, '').replace(/\.{2}(?!\.)/g, "")
 
    const [bucket, ...rest] = String(path).split('/');

    const allowBuckets : string = req.buckets || []
    
    if(!(allowBuckets.includes(bucket) || allowBuckets[0] === '*')) {
      return res.forbidden()
    }
      
    let filePath = rest.join('/')

    if(filePath != null) {
      filePath = this._normalizeFolder(String(filePath))
    }

    const { stream , set } = await this._makeStream({
      bucket   : bucket,
      filePath : String(filePath) ,
      range    : req.headers?.range,
      download : true
    })

    set(res)
    
    return stream.pipe(res)

  }

  private _studioLogin = async ({  res , body } : TContext) => {

    if(this._studioCheck == null) {
      return res.badRequest('Please enable the studio')
    }

    const { username , password } = body

    if(!username || !password) {
      return res.badRequest('Please enter an username and password')
    }

    const check = await this._studioCheck({ username : String(username), password : String(password) })
    
    if(!check?.logged)   return res.unauthorized('Please check your username and password')
      
    const session = jwt.sign({
      data : {
        issuer : 'nfs-studio',
        sub : {
          buckets : check?.buckets ?? [],
          token  : ''
        }
      }
    }, this._jwtSecret , { 
      expiresIn : this._jwtExipred , 
      algorithm : 'HS256'
    })
  
    res.setHeader('Set-Cookie', 
      `auth.session=${session}; HttpOnly; Max-Age=3600; Path=/studio`
    )

    return res.ok()
  }

  private _studioLogout = async ({  res } : TContext) => {

    res.setHeader('Set-Cookie', 
      `auth.session=; HttpOnly; Max-Age=0; Path=/studio`
    )

    return res.ok()
  }

  private _studioUpload = async ({ req, res , files , body } : TContext) => {
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
      
      let folder = rest.join('/')

      if(folder != null) {
        folder = this._normalizeFolder(String(folder))
      }

      const directory = this._normalizeDirectory({ bucket , folder })

      if (!(await this._fileExists(directory))) {

        if(this._debug) {
          console.log({ directory , bucket , folder })
        }

        fsSystem.mkdirSync(directory, {
          recursive: true
        })
      }

      const writeFile = (file : string , to : string) => {
        return new Promise<null>((resolve, reject) => {
          fsSystem.createReadStream(file)
          .pipe(fsSystem.createWriteStream(to))
          .on('finish', () => {
            this._remove(to)
            this._remove(file,{ delayMs : 0 })
            return resolve(null)
          })
          .on('error', (err) => reject(err));
          return 
        })
      }

      const name = `${+new Date()}_${file.name}`

      await writeFile(file.tempFilePath , this._normalizePath({ directory , path : name , full : true }))

      return res.ok({
        path : this._normalizePath({ directory : folder , path :name }),
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

  private _studioBucket = async ({ req , res } : TContext) => {
   
    const allowBuckets : string[] = req.buckets ?? []

    const rootFolder = this._rootFolder

    const buckets = this._buckets == null 
      ? fsSystem.readdirSync(pathSystem.join(pathSystem.resolve(),rootFolder)).filter((name) => {
        return fsSystem.statSync(pathSystem.join(rootFolder, name)).isDirectory();
      }) 
      : await this._buckets()

    const lists : any[] = []

    for(const bucket of buckets) {

      if(allowBuckets.includes(bucket) || allowBuckets[0] === '*') {
        const targetDir = `${rootFolder}/${bucket}`
        const structures = this._fileStructure(targetDir);
  
        lists.push({
          [bucket] : structures
        })
      }
    }

    return res.ok({
      buckets : lists
    })
      
  }

  private _studioFiles = async ({ req, res , params } : TContext) => {
   
    const rootFolder = this._rootFolder

    const path = String(params['*']).replace(/^\/+/, '').replace(/\.{2}(?!\.)/g, "")

    const [bucket] = String(path).split('/')

    const allowBuckets : string = req.buckets || []
    
    if(!(allowBuckets.includes(bucket) || allowBuckets[0] === '*')) {
      return res.forbidden()
    }

    const targetDir = `${rootFolder}/${path}`

    if(!fsSystem.existsSync(pathSystem.join(pathSystem.resolve(),targetDir))) {
      return res.notFound(`The directory '${path}' does not exist`)
    }

    const files = this._fileStructure(targetDir , { includeFiles : true })

    return res.ok({
      files : files.sort(( a , b) => (b.isFolder - a.isFolder))
    })
      
  }

  private _studioEdit = async ({ req, res , params , body } : TContext) => {
   
    const path = String(params['*']).replace(/^\/+/, '').replace(/\.{2}(?!\.)/g, "")
 
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
      filePath = this._normalizeFolder(String(filePath))
    }

    const oldPath = this._normalizeDirectory({ bucket , folder : filePath })

    if(!fsSystem.existsSync(pathSystem.join(pathSystem.resolve(),oldPath))) return res.notFound()

    const newPath = this._normalizeDirectory({ 
      bucket , 
      folder : `${rename}${pathSystem.extname(filePath)}`
    })

    fsSystem.renameSync(
      pathSystem.join(pathSystem.resolve(),oldPath),
      pathSystem.join(pathSystem.resolve(),newPath),
    );

    return res.ok({
      name : rename
    })
      
  }

  private _studioRemove = async ({ req, res , body , params } : TContext) => {
   
    const path = String(params['*']).replace(/^\/+/, '').replace(/\.{2}(?!\.)/g, "")
 
    const [bucket, ...rest] = String(path).split('/');

    const allowBuckets : string = req.buckets || []
    
    if(!(allowBuckets.includes(bucket) || allowBuckets[0] === '*')) {
      return res.forbidden()
    }

    let filePath = rest.join('/')

    if(filePath != null) {
      filePath = this._normalizeFolder(String(filePath))
    }

    const fullPath = pathSystem.join(pathSystem.resolve(),this._normalizeDirectory({ bucket , folder : filePath }))

    if(!fsSystem.existsSync(fullPath)) return res.notFound()

    fsSystem.unlinkSync(fullPath)

    return res.ok()
      
  }

  private _fileStructure = (dirPath: string , { includeFiles = false } : { includeFiles ?: boolean} = {}): any[] => {
    const items: any[] = [];

    const files = fsSystem.readdirSync(dirPath)

    for (const file of files) {

      const path = pathSystem.join(dirPath, file)
      const fullPath = pathSystem.join(pathSystem.resolve(),dirPath, file)
      const stats = fsSystem.lstatSync(fullPath)

      const lastModified = stats.mtime

      if (stats.isDirectory()) {
        items.push({
            name: file,
            path: path.replace(/\\/g, '/').replace(`${this._rootFolder}/`,''),
            isFolder: true,
            lastModified,
            folders: this._fileStructure(path , { includeFiles })
        })

        continue
      }

      if(!includeFiles) continue
          
      const extension = pathSystem.extname(file).replace(/\./g,'')

      items.push({
          name: file,
          path: path.replace(/\\/g, '/').replace(this._rootFolder, ''),
          isFolder: false,
          lastModified,
          size: stats.size,
          extension
      })

    }

    return items;
  };
  
  private async _makeStream ({ bucket , filePath , range , download = false } : { 
    bucket : string; 
    filePath : string; 
    range ?: string; 
    download : boolean 
  }) {

    const getContentType = (extension : string) => {
        switch (String(extension).toLowerCase()) {
            case 'txt':
                return 'text/plain';
            case 'html':
            case 'htm':
                return 'text/html';
            case 'css':
                return 'text/css';
            case 'js':
                return 'application/javascript';
            case 'json':
                return 'application/json';
            case 'xml':
                return 'application/xml';
            case 'pdf':
                return 'application/pdf';
            case 'doc':
            case 'docx':
                return 'application/msword';
            case 'xls':
            case 'xlsx':
                return 'application/vnd.ms-excel';
            case 'ppt':
            case 'pptx':
                return 'application/vnd.ms-powerpoint';
            case 'jpg':
            case 'jpeg':
                return 'image/jpeg';
            case 'png':
                return 'image/png';
            case 'gif':
                return 'image/gif';
            case 'bmp':
                return 'image/bmp';
            case 'svg':
                return 'image/svg+xml';
            case 'mp3':
                return 'audio/mpeg';
            case 'wav':
                return 'audio/wav';
            case 'ogg':
                return 'audio/ogg';
            case 'mp4':
                return 'video/mp4';
            case 'avi':
                return 'video/x-msvideo';
            case 'mpeg':
                return 'video/mpeg';
            case 'zip':
                return 'application/zip';
            case 'rar':
                return 'application/x-rar-compressed';
            case 'tar':
                return 'application/x-tar';
            case 'gz':
                return 'application/gzip';
            case '7z':
                return 'application/x-7z-compressed';
            default:
                return 'application/octet-stream';
        }
    }

    const directory = this._normalizeDirectory({ bucket , folder : null})

    const path =  this._normalizePath({ directory , path : filePath , full : true })
 
    const contentType = getContentType(String(filePath?.split('.')?.pop()))
  
    const stat = fsSystem.statSync(path)
  
    const fileSize = stat.size

    const set = (header : Record<string,any> , filePath : string , code = 200 ) => {
  
      const extension = filePath.split('.').pop()
  
      const previews = ['mp3','mp4','pdf','png','jpeg','jpg','gif']
  
      return (res : any) => {

        if(previews.some(p => extension?.toLocaleLowerCase() === p)) {
  
          res.writeHead(download ? code : 206, header)
  
          return
        }

        if(download) {
          res.setHeader('Content-Disposition', `attachment; filename=${+new Date()}.${extension}`)
          res.setHeader('Content-Type', 'application/octet-stream')
        }
      }
    }

    if(contentType !== 'video/mp4') {
      
      const header = {
        'Content-Length': fileSize,
        'Content-Type': contentType,
      };
  
      return {
        stream :fsSystem.createReadStream(path),
        header,
        set : set(header,filePath)
      }
    }
  
    if(range == null) {
      const header = {
        'Content-Length': fileSize,
        'Content-Type': contentType
      }
  
      return {
        stream :fsSystem.createReadStream(path),
        header,
        set : set(header,filePath)
      }
    }

    const parts = range.replace(/bytes=/, "").split("-");
    const start = parseInt(parts[0], 10)
    const end = parts[1]? parseInt(parts[1], 10) : fileSize-1;
  
    const chunksize = (end - start) + 1
  
    const stream = fsSystem.createReadStream(path , { start, end })
  
    const header = {
      'Content-Range': `bytes ${start}-${end}/${fileSize}`,
      'Accept-Ranges': 'bytes',
      'Content-Length': chunksize,
      'Content-Type': contentType
    }
  
    return {
      stream,
      header,
      set : set(header,filePath,206)
    }
  }

  private _verify (token : string) {

    try {
     
      const decoded : any = jwt.verify(token, this._jwtSecret)
  
      return decoded.data.sub as {
        token : string
        bucket : string
        buckets : string[]
      }
  
    } catch (err:any) {

        let message = err.message

        if (err.name === 'JsonWebTokenError') {
          message = 'Invalid credentials'
        } 
        
        if (err.name === 'TokenExpiredError') {
          message = 'Token has expired'
        } 

        const error:any = new Error(message)

        error.statusCode = 400
              
        throw error      
    }
  }

  private _authMiddleware = ({ req, res , headers } : TContext , next : TNextFunction) => {

    const authorization = String(headers.authorization).split(' ')[1]

    if(authorization == null) {
      return res.status(401).json({
        message : 'Please check your credentials. Are they valid ?'
      })
    }

    const { bucket , token } = this._verify(authorization)

    req.bucket = bucket

    req.token  = token

    return next()
  }

  private _authStudioMiddleware = ({ req, res , cookies } : TContext , next : TNextFunction) => {

    const authorization = cookies['auth.session']

    if(authorization == null || authorization === '') {
      if(req.url?.includes('/studio/preview')) {
      
        res.writeHead(401 , { 'Content-Type': 'text/xml'})
          const error = {
              Error : [
                  { Code : 'Unauthorized' },
                  { Message : 'Please check your credentials. Are they valid ?'},
                  { Resource : req.url },
                  { RequestKey : "" }
              ]
          }
  
          return res.end(xml([error],{ declaration: true }))
      }

      return res.status(401).json({
        message : 'Please check your credentials. Are they valid ?'
      })
    }

    try {

      const { buckets , token } = this._verify(authorization)

      req.buckets = buckets
  
      req.token  = token

      console.log({
        buckets,
        token
      })

      return next()

    } catch (e : any) {

      if(req.url?.includes('/studio/preview')) {
      
        res.writeHead(400 , { 'Content-Type': 'text/xml'})
          const error = {
              Error : [
                { Code : 'Bad Request' },
                { Message : e.message },
                { Resource : req.url },
                { RequestKey : "" }
              ]
          }
  
          return res.end(xml([error],{ declaration: true }))
      }

      return res.status(400).json({
        message : e.message
      })
    }
  }

  private async _files (dir : string , { ignore = null} : { ignore ?: string | null } = {}) {
    const directories = fsSystem.readdirSync(dir, { withFileTypes: true })

    const files : any[] = await Promise.all(directories.map((directory) => {
      const newDir = pathSystem.resolve(String(dir), directory.name)

      if (directory.isDirectory() && (ignore != null && directory.name === ignore)) {
        return null
      }

      return directory.isDirectory() ? this._files(newDir) : newDir
    }))

    return [].concat(...files.filter(Boolean))
  }

  private _normalizeFolder(folder : string): string {
    return folder.replace(/^\/+/, '').replace(/[?#]/g, '')
  }

  private _normalizeDirectory({ bucket , folder } : { bucket : string , folder ?: string | null }): string {

    return folder == null 
      ? `${this._rootFolder}/${bucket}`
      : `${this._rootFolder}/${bucket}/${this._normalizeFolder(folder)}` 
  }

  private _normalizePath({ directory , path , full = false } : { 
    directory ?: string | null
    path : string
    full ?: boolean 
  }): string {

    const normalized = full 
    ? directory == null 
      ?  pathSystem.join(pathSystem.resolve(),`${path.replace(/^\/+/, '')}`)
      :  pathSystem.join(pathSystem.resolve(),`${directory}/${path.replace(/^\/+/, '')}`)
    : directory == null 
      ? `${path.replace(/^\/+/, '')}`
      : `${directory}/${path.replace(/^\/+/, '')}`

    return normalized
    
  }

  private _remove (path : string , { delayMs = 1000 * 60 * 60  } : { delayMs ?: number } = {}) {

    if(delayMs === 0) {
      fsSystem.unlink(path , (_) => null)
      return
    }

    setTimeout(() => {
      fsSystem.unlink(path , (_) => null)
    }, delayMs)

    return
  }

  private async _trashed ({ path , bucket, filename } : { 
    path     : string
    bucket   : string
    filename : string 
  }) {

    const folder = `${this._trash}/${new Time().onlyDate().toString()}`

    const directory = this._normalizeDirectory({ bucket , folder })

    const newPath = this._normalizePath({ directory , path : filename , full : true })

    const newDirectory = pathSystem.dirname(newPath);

    if(!(await this._fileExists(newDirectory))) {
      fsSystem.mkdirSync(newDirectory, {
        recursive: true
      })
    }

    return await fsSystem.promises
    .rename(path , newPath)
    .catch(_ => {
      return
    })
  }

  private async _fileExists(path : string) : Promise<boolean> {
    try {
      await fsSystem.promises.stat(path);
      return true
    } catch (err) {
      return false
    }
  }
  
  private _removeOldDirInTrash = async (bucket : string) => {
    
    const directory = this._normalizeDirectory({ bucket , folder : this._trash })

    const files = await fsSystem.promises.readdir(directory)

    for (const file of files) {

      const dir = this._normalizePath({ directory , path : file , full : true })
    
      const stats = await fsSystem.promises.stat(dir)

      if(!stats.isDirectory()) continue

      const format = file.match(/^\d{4}-\d{2}-\d{2}/)

      const folderDate = new Time(format ? format[0] : 0).toTimestamp()

      const ago = new Time().minusDays(this._backup).toTimeStamp()

      if(Number.isNaN(folderDate) || folderDate > ago) continue
      
      await this._removeDir(dir)

    }

  }

  private _removeDir = async (path : string) => {

    return await fsSystem.promises
    .rm(path, { recursive: true })
    .catch(_ => {
      return
    })
  }

}

export { NfsServer}
export default NfsServer