import pathSystem from 'path'
import fsSystem   from 'fs'
import jwt        from 'jsonwebtoken'
import xml        from 'xml'
import bcrypt     from 'bcrypt'
import { Server } from 'http'
import { Logger, Time }   from 'tspace-utils'
import Spear , { 
  Router, TContext, 
  TNextFunction
} from 'tspace-spear'
import html from './default-html'
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

  private _app            !: Spear 
  private _router         !: Router 
  private _html           !: string | null
  private _credentials    !: Function | null
  private _fileExpired    : number = 60 * 60
  private _rootFolder     : string = 'nfs'
  private _cluster        : boolean | number = false
  private _jwtExipred     : number = 60 * 60
  private _jwtSecret      : string = `<secret@${+new Date()}:${Math.floor(Math.random() * 9999)}>`
  private _progress       : boolean = false
  private _debug          : boolean = false

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
   * @property {number}  credentials.expired
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
   * The 'listen' method is used to bind and start a server to a particular port and optionally a hostname.
   * 
   * @param {number} port 
   * @param {function} cb
   * @returns 
   */
  listen(port:number, cb ?: ({port , server} : { port : number , server : Server }) => void) {

    this._app = new Spear({
      cluster : this._cluster
    })

    this._app.useLogger({
      exceptPath  : /\/benchmark(\/|$)|\/favicon\.ico(\/|$)/
    })

    this._app.useBodyParser()
    
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
      router.post('/connect', this._API_Connect)
      router.post('/storage', this._authMiddleware ,this._API_Storage)
      router.post('/file',    this._authMiddleware , this._API_File)
      router.post('/folders', this._authMiddleware , this._API_Folders)
      router.post('/base64',  this._authMiddleware ,this._API_Base64)
      router.post('/stream',  this._authMiddleware ,this._API_Stream)
      router.post('/remove',  this._authMiddleware ,this._API_Remove)
      router.post('/upload',  this._authMiddleware ,this._API_Upload)
      router.post('/upload/merge',   this._authMiddleware ,this._API_Merge)
      router.post('/upload/base64' , this._authMiddleware ,this._API_UploadBase64)
      return router
    })

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

    this._app.catch((err : Error , { res } : TContext) => {

      if(this._debug) {
        console.log(err)
      }

      return res
        .status(500)
        .json({
          message    : err?.message
      });
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
            key , 
            expires , 
            signature , 
            download
        } = query as { 
          key : string, 
          expires : string, 
          signature : string,
          download : string
        }

        const bucket = params.bucket
      
        if([
          key , expires , signature , download , bucket
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

        const path = String(params['*']).replace(/^\/+/, '')
        const combined = `@{${path}-${bucket}-${key}-${expires}-${download}}`
        const compare  = bcrypt.compareSync(combined, Buffer.from(signature,'base64').toString('utf-8'))
        const expired  = Number.isNaN(+expires) ? true : new Date(+expires) < new Date() 
  
        if(!compare || expired) {
            
            res.setHeader('Content-Type', 'text/xml')
  
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
          bucket,
          filePath : String(path) ,
          range  :req.headers?.range,
          download : download === 'true'
        })
  
        if(stream == null || header == null) {
  
            res.setHeader('Content-Type', 'text/xml')
  
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
        res.setHeader('Content-Type', 'text/xml')
  
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

  private _API_File =  async ({ req , res , body } : TContext) => {
    try {
  
      const { bucket , token } = req

      let { path , download , expired } = body

      const fileName = `${path}`.replace(/^\/+/, '')

      const directory = this._normalizeDirectory({ bucket , folder : null })

      const fullPath = this._normalizePath({ directory , path : String(path) , full : true })

      if(!fsSystem.existsSync(fullPath)) {
        return res.status(404).json({
          message : `No such directory or file, '${fileName}'`
        })
      }
  
      const key       = String(token)
      const expires   = new Time().addSeconds(expired == null || Number.isNaN(Number(expired)) ? this._fileExpired : Number(expired)).toTimeStamp()
      const combined  = `@{${path}-${bucket}-${key}-${expires}-${download}}`
      const signature = Buffer.from(bcrypt.hashSync(combined , 1)).toString('base64')
  
      return res.ok({
        endpoint : [
          `${bucket}/${fileName}?key=${key}`,
          `expires=${expires}`,
          `download=${download}`,
          `signature=${signature}`
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

  private _API_Base64 =  async ({  req, res , body } : TContext) => {
    try {
  
      const { bucket } = req

      const { path : filename } = body

      const directory = this._normalizeDirectory({ bucket , folder : null })

      const path = this._normalizePath({ directory , path : String(filename) , full : true})
  
      if(!fsSystem.existsSync(path)) {
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

  private _API_Stream = async ({ req , res , body } : TContext) => {

    try {

      const { bucket } = req

      const { path : filename , range } = body

      const directory = this._normalizeDirectory({ bucket , folder : null })

      const fullPath = this._normalizePath({ directory , path : String(filename) , full : true})
      
      if(!fsSystem.existsSync(fullPath)) {
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

  private _API_Storage =  async ({ req, res , body } : TContext) => {
    try {
  
      const { bucket } = req

      let { folder } = body

      if(folder != null) {
        folder = this._normalizeFolder(String(folder))
      }
   
      const directory = this._normalizeDirectory({ bucket , folder })

      if(!fsSystem.existsSync(directory)) {
        return res.status(404).json({
          message : `No such directory or folder, '${folder}'`
        })
      }
  
      const fileDirectories = await this._files(directory)

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

  private _API_Folders =  async ({ req, res } : TContext) => {

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

  private _API_Upload = async ({ req , res , files , body } : TContext) => {
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

      if (!fsSystem.existsSync(directory)) {

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
            this._remove(file,0)
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

  private _API_Merge = async ({ req , res , body } : TContext) => {
  
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

      if (!fsSystem.existsSync(directory)) {
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
              this._remove(partPath,0)
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

  private _API_UploadBase64 = async ({ req, res, body  } : TContext) => {
  
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

      if (!fsSystem.existsSync(directory)) {
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

  private _API_Remove =  async ({ req, res , body } : TContext) => {
    try {
  
      const { bucket } = req

      const { path : p } = body

      const filename = `${p}`.replace(/^\/+/, '')

      const directory = this._normalizeDirectory({ bucket , folder : null })
      
      const path = this._normalizePath({ directory , path : filename , full : true})
     
      if(!fsSystem.existsSync(path)) {
        return res.status(404)
        .json({
          message : `No such directory or file, '${filename}'`
        })
      }

      this._remove(path,0)
  
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

  private _API_Connect = async ({ res , body } : TContext) => {
  
    const { token , secret , bucket } = body

    if(this._credentials != null) {

      const credentials = await this._credentials({ 
        token,
        secret,
        bucket
      })
  
      if(!credentials) {
        return res.status(401).json({
          message : 'Invalid credentials. Please check the your credentials'
        })
      }
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

    const authorization = String(headers.authorization).split(' ')[1];

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

  private async _files (dir : string) {
    const directories = fsSystem.readdirSync(dir, { withFileTypes: true })
    const files : any[] = await Promise.all(directories.map((directory) => {
      const newDir = pathSystem.resolve(String(dir), directory.name)
      return directory.isDirectory() ? this._files(newDir) : newDir
    }))

    return [].concat(...files)
    
  }

  private _normalizeFolder(folder : string): string {
    return folder.replace(/^\/+/, '').replace(/[.?#]/g, '')
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

    return full 
      ? directory == null 
        ?  pathSystem.join(pathSystem.resolve(),`${path.replace(/^\/+/, '')}`)
        :  pathSystem.join(pathSystem.resolve(),`${directory}/${path.replace(/^\/+/, '')}`)
      : directory == null 
        ? `${path.replace(/^\/+/, '')}`
        : `${directory}/${path.replace(/^\/+/, '')}`
  }

  private _remove (path : string , delayMs : number = 1000 * 60 * 60 * 2) {

    if(delayMs === 0) {
      fsSystem.unlink(path , (_) => null)
      return
    }

    setTimeout(() => {
      fsSystem.unlink(path , (_) => null)
    }, delayMs)

    return
  }
}

export { NfsServer}
export default NfsServer