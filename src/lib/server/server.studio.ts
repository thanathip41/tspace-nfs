import pathSystem        from 'path'
import fsSystem          from 'fs'
import jwt               from 'jsonwebtoken'
import archiver          from 'archiver'
import { minify }        from 'html-minifier-terser'
import xml               from 'xml'
import { type TContext } from 'tspace-spear'
import { NfsServerCore } from './server.core'

export class NfsStudio extends NfsServerCore {

  private BASE_FOLDER_STUDIO = 'studio-html'
    
  protected studio = async ({  res , cookies } : TContext) => {

    const auth = cookies['auth.session']

    if(!auth || auth == null) {
      const html = await fsSystem.promises.readFile(pathSystem.join(__dirname, this.BASE_FOLDER_STUDIO,'login.html'), 'utf8')

      const minifiedHtml = await minify(html, {
        collapseWhitespace: true,
        removeComments: true,
        minifyCSS: true,
        minifyJS: true
      })
      return res.html(minifiedHtml);
    }

    const html = await fsSystem.promises.readFile(pathSystem.join(__dirname, this.BASE_FOLDER_STUDIO,'index.html'), 'utf8')

    const minifiedHtml = await minify(html, {
      collapseWhitespace: true,
      removeComments: true,
      minifyCSS: true,
      minifyJS: true
    });

    return res.html(minifiedHtml);
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

  protected studioPreview = async ({  req, res , params } : TContext) => {

    const path = String(params['*']).replace(/^\/+/, '').replace(/\.{2}(?!\.)/g, "")
 
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
     
      return res.html(minifiedHtml.replace('{{language}}',language))
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

    const path = String(params['*']).replace(/^\/+/, '').replace(/\.{2}(?!\.)/g, "")
 
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
    
    const path = String(params['*']).replace(/^\/+/, '').replace(/\.{2}(?!\.)/g, "")
 
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

  protected studioLogin = async ({  res , body } : TContext) => {

    if(this._onStudioCredentials == null) {
      return res.badRequest('Please enable the studio')
    }

    const { username , password } = body

    if(!username) {
      return res.badRequest('Please enter an username')
    }

    const check = await this._onStudioCredentials({ username : String(username), password : String(password) })
    
    if(!check?.logged)   return res.unauthorized('Please check your username and password')
    
    const EXPIRED = 43_200
    const session = jwt.sign({
      data : {
        issuer : 'nfs-studio',
        sub : {
          buckets : check?.buckets ?? [],
          permissions : ['*'],
          token  : Buffer.from(`${+new Date()}`).toString('base64')
        }
      }
    }, this._jwtSecret , { 
      expiresIn : EXPIRED , 
      algorithm : 'HS256'
    })
  
    res.setHeader('Set-Cookie', 
      `auth.session=${session}; HttpOnly; Max-Age=${EXPIRED}; Path=/studio`
    )

    const rootFolder = this._rootFolder

    const buckets = (this._buckets == null 
      ? fsSystem.readdirSync(pathSystem.join(pathSystem.resolve(),rootFolder)).filter((name) => {
        return fsSystem.statSync(pathSystem.join(rootFolder, name)).isDirectory();
      }) 
      : await this._buckets()
    )

    for(const bucket of buckets) {
      console.log('sync metadata: ', bucket)
      await this._utils.syncMetadata(bucket)
    }

    return res.ok()
  }

  protected studioLogout = async ({  res } : TContext) => {

    res.setHeader('Set-Cookie', 
      `auth.session=; HttpOnly; Max-Age=0; Path=/studio`
    )

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

      await this._utils.syncMetadata(bucket)

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
      
      const archive = archiver('zip', { zlib: { level: 1 } });

      res.setHeader('Content-Disposition', `attachment; filename="NFS-studio_${+new Date()}.zip"`);
      res.setHeader('Content-Type', 'application/zip');
    
      archive.pipe(res)
      
      for (const item of items) {
        if (item.isFolder) {
          archive.directory(item.path, item.name);
          continue
        } 
        archive.file(item.path, { name: item.name });
      }
      
      archive.finalize();

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
            const random  = () => [1,2,3].map(v => Math.random().toString(36).substring(3)).join('')
            await this._onStudioBucketCreated({
              bucket : String(bucket),
              token : String(random()),
              secret : String(random())
            })
          }
        }

        const loadCredentials = this._onLoadBucketCredentials == null ? [] : await this._onLoadBucketCredentials();

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
   
    const data = String(params['*']).replace(/^\/+/, '').replace(/\.{2}(?!\.)/g, "")
 
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
      await this._utils.syncMetadata(bucket)
      return res.ok()
    }

    this._queue.add(async () => await this._utils.trashed({ path , bucket  }))

    return res.ok()
      
  }

  protected studioGetPathShared = async ({  req, res , params } : TContext) => {

    const path = String(params['*']).replace(/^\/+/, '').replace(/\.{2}(?!\.)/g, "")
 
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
      expiresIn : 60 * 60 * 24 * 30, 
      algorithm : 'HS256'
    })

     return res.ok({
      path : `studio/shared/${path}?key=${token}`
    })
  }

  protected studioShared = async ({  req, res , params , query } : TContext) => {

    const path = String(params['*']).replace(/^\/+/, '').replace(/\.{2}(?!\.)/g, "")
 
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

    const { success, data } = this._verifyShared(token)

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

  private _verifyShared (token : string) {
  
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
}