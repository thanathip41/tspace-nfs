import Path       from 'path';
import fs         from 'fs';
import jwt        from 'jsonwebtoken'
import xml        from 'xml'
import bcrypt     from 'bcrypt'
import { Server } from 'http'
import { Time }   from 'tspace-utils'
import Spear , { 
  Router, TContext 
} from 'tspace-spear'

class NfsServer {

  private _router !: Router 
  private _HTML : string | null = null
  private _credentials : Function | null = null
  private _expired : number = 1000 * 60 * 15
  private _rootFolder : string = 'nfs'
  private _JWT_EXPRIRES = 1000 * 60 * 60
  private _JWT_SECRET = "<SECRET>"
  private _app : Spear = new Spear({
    logger : true
  })

  get instance () {
    return this._app
  }

  defaultPage (html : string) {
    this._HTML = html
    return this
  }

  directory(folder : string) {

    this._rootFolder = folder

    return this
  }

  listen(port:number, cb ?: ({port , server} : { port : number , server : Server }) => void) {

    this._app.useBodyParser()
    
    this._app.useFileUpload({
      limit : Infinity,
      tempFileDir : 'tmp',
      removeTempFile : {
        remove : true,
        ms : 1000 * 30
      }
    })
    
    this._router = new Router()

    this._router .get('/' , this._default)
    this._router .get('/media/*' , this._MEDIA)
    this._router .post('/api/connect' , this._API_CONNECT)
    this._router .post('/api/storage' , this._API_STORAGE)
    this._router .post('/api/file' , this._API_FILE)
    this._router .post('/api/base64' , this._API_BASE64)
    this._router .post('/api/stream' , this._API_STREAM)
    this._router .post('/api/upload' , this._API_UPLOAD)

    this._app.useRouter(this._router)

    this._app.notFoundHandler(({  req , res }) => {
      res.setHeader('Content-Type', 'text/xml')
        const error = {
            Error : [
                { Code : 'Not found' },
                { Message : 'The request was invalid'},
                { Resource : req.url },
            ]
        }

        return res.end(xml([error],{ declaration: true }))
    })
    
    this._app.listen(port, ({ port , server }) => cb == null ? null : cb({ port , server }))
  }

  fileExpired (ms : number) {
    this._expired = ms
    return this
  }

  onCredentials (callback : ({ token , secret , bucket } : { token : string; secret : string; bucket : string}) => Promise<boolean>) {

    this._credentials = callback

    return this

  } 

  credentials ({ expired , secret } : { expired : number , secret : string}) {

    this._JWT_EXPRIRES = expired

    this._JWT_SECRET = secret

    return this
  }

  private _default = async ({ res } : TContext) => {

    const html = `
      <!DOCTYPE html>
      <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>NFS-Server</title>
        </head>
        <body>
        </body>
      </html>
    `
    res.statusCode = 200;
    res.setHeader('Content-Type', 'text/html');
    return res.end(this._HTML == null ? html : String(this._HTML));
  }
  
  private _MEDIA = async ({ req , res , query , params} : TContext) => {
      try {

        const { 
            key , 
            expires , 
            signature , 
            bucket,
            download
        } = query as { 
          bucket: string,
          key : string, 
          expires : string, 
          signature : string,
          download : string
        }
      
        if([
          key , expires , signature , bucket , download 
        ].some(v => v === '' || v == null)) {

          res.setHeader('Content-Type', 'text/xml')
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

  private _API_FILE =  async ({ res , body , headers } : TContext) => {
    try {
  
      const authorization = String(headers.authorization).split(' ')[1];

      if(authorization == null) {
        return res.status(401).json({
          message : 'unauthorized'
        })
      }
  
      const { bucket , token } = this._verify(authorization)

      const { path , download } = body

      const fileName = `${path}`.replace(/^\/+/, '')
      
      const dir = Path.join(Path.resolve(),`${this._rootFolder}/${bucket}/${fileName}`)
  
      if(!fs.existsSync(dir)) {
        return res.status(404).json({
          message : `No such directory or file, '${fileName}'`
        })
      }
  
      const key       = String(token)
      const expires   = new Time().addSeconds(this._expired).toTimeStamp()
      const combined  = `@{${path}-${bucket}-${key}-${expires}-${download}}`
      const signature = Buffer.from(bcrypt.hashSync(combined , 1)).toString('base64')
  
      return res.ok({
        endpoint : [
          `media/${fileName}?bucket=${bucket}`,
          `key=${key}`,
          `expires=${expires}`,
          `download=${download}`,
          `signature=${signature}`
        ].join('&')
      })
  
    } catch (err : any) {
      return res.status(500).json({
        message : err.message
      })
    }
  }

  private _API_BASE64 =  async ({ res , body , headers } : TContext) => {
    try {
  
      const { path : filename } = body

      const authorization = String(headers.authorization).split(' ')[1];

      if(authorization == null) {
        return res.status(401).json({
          message : 'unauthorized'
        })
      }
  
      const { bucket } = this._verify(authorization)
      
      const dir = Path.join(Path.resolve(),`${this._rootFolder}/${bucket}/${filename}`)
  
      if(!fs.existsSync(dir)) {
        return res.status(404).json({
          message : `no such file or directory, '${filename}'`
        })
      }
  
      return res.json({
        base64 : fs.readFileSync(dir, 'base64')
      })
  
    } catch (err : any) {
      return res.status(500).json({
        message : err.message
      })
    }
  }

  private _API_STREAM = async ({ req , res , body , headers } : TContext) => {

    const { path : filename , range } = body

    const authorization = String(headers.authorization).split(' ')[1];

    if(authorization == null) {
      return res.status(401).json({
        message : 'unauthorized'
      })
    }

    const { bucket } = this._verify(authorization)
    
    const dir = Path.join(Path.resolve(),`${this._rootFolder}/${bucket}/${filename}`)

    if(!fs.existsSync(dir)) {
      return res.status(404).json({
        message : `no such file or directory, '${filename}'`
      })
    }

    const stat = fs.statSync(dir);
    const fileSize = stat.size;
  
    if (range) {
      const parts = String(range).replace(/bytes=/, "").split("-");
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
      const chunksize = (end - start) + 1;
      const file = fs.createReadStream(dir, { start, end });
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

    return fs.createReadStream(dir).pipe(res);
  }

  private _API_STORAGE =  async ({ res , body , headers } : TContext) => {
    try {
  
      const authorization = String(headers.authorization).split(' ')[1];

      if(authorization == null) {
        return res.status(401).json({
          message : 'unauthorized'
        })
      }

      const { folder } = body
  
      const { bucket } = this._verify(authorization)
      
      const directory = Path.join(
        Path.resolve(), 
        folder == null 
          ? `${this._rootFolder}/${bucket}` 
          : `${this._rootFolder}/${bucket}/${folder}`
      )

      if(!fs.existsSync(directory)) {
        return res.status(404).json({
          message : `No such directory or folder, '${folder}'`
        })
      }
  
      const fileDirectories = await this._files(directory)

      const storage = fileDirectories.map((name) => {
        const stat = fs.statSync(name)
        return {
          name :  Path.relative(directory, name).replace(/\\/g, '/'),
          size : Number((stat.size / (1024 * 1024))) 
        }
      })

      return res.ok({
        storage
      })
  
    } catch (err : any) {
      return res.status(500).json({
        message : err.message
      })
    }
  }

  private _API_UPLOAD = async ({ res , files , body , headers } : TContext) => {
  
    const authorization = String(headers.authorization).split(' ')[1];

    if(authorization == null) {
      return res.status(401).json({
        message : 'unauthorized'
      })
    }

    const { bucket } = this._verify(authorization)

    const file = files?.file[0]

    const { folder } = body
  
    if (file == null) {
      return res.status(400).json({
        message : 'No file were uploaded.'
      })
    }

    const fullDirectory = folder ? `${this._rootFolder}/${bucket}/${folder}` : `${this._rootFolder}/${bucket}`

    if (!fs.existsSync(fullDirectory)) {
      fs.mkdirSync(fullDirectory, {
        recursive: true
      })
    }

    const writeFile = (file : string , to : string) => {
      return new Promise<null>((resolve, reject) => {
        fs.createReadStream(file, { encoding: 'base64' })
        .pipe(fs.createWriteStream(to, { encoding: 'base64' }))
        .on('finish', () => {
          return resolve(null)
        })
        .on('error', (err) => reject(err));
        return 
      })
    }

    await writeFile(file.tempFilePath , Path.join(Path.resolve(),`${fullDirectory}/${file.name}`))

    return res.ok()
  }

  private _API_CONNECT = async ({ res , body } : TContext) => {
  
    const { token , secret , bucket } = body

    if(this._credentials != null) {
      const credentials = await this._credentials({ 
        token,
        secret,
        bucket
      })
  
      if(!credentials) {
        return res.status(401).json({
          message : 'Bad credentials. Please check the your credentials'
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
      }, this._JWT_SECRET , { expiresIn : this._JWT_EXPRIRES , algorithm : 'HS256'})
    })
  }
  
  private _makeStream = async ({ bucket , filePath , range , download = false } : { 
    bucket : string; 
    filePath : string; 
    range ?: string; 
    download : boolean 
  }) => {

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

    const directory =  Path.join(Path.resolve(),`${this._rootFolder}/${bucket}/${filePath}`)
  
    const contentType = getContentType(String(filePath?.split('.')?.pop()))
  
    const videoStat = fs.statSync(directory)
  
    const fileSize = videoStat.size;

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
        stream :fs.createReadStream(directory),
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
        stream :fs.createReadStream(directory),
        header,
        set : set(header,filePath)
      }
    }

    const parts = range.replace(/bytes=/, "").split("-");
    const start = parseInt(parts[0], 10)
    const end = parts[1]? parseInt(parts[1], 10) : fileSize-1;
  
    const chunksize = (end - start) + 1
  
    const stream = fs.createReadStream(directory , {start, end})
  
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

  private _verify = (token : string) => {
    try {
      
      const decoded : any = jwt.verify(token, this._JWT_SECRET)
  
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

  private async _files (dir : string) {
    const directories = fs.readdirSync(dir, { withFileTypes: true })
    const files : any[] = await Promise.all(directories.map((directory) => {
      const newDir = Path.resolve(String(dir), directory.name)
      return directory.isDirectory() ? this._files(newDir) : newDir
    }))

    return [].concat(...files)
    
  }
}

export { NfsServer}
export default NfsServer