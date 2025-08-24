import xml              from 'xml'
import cron             from 'node-cron'
import { Server }       from 'http'
import { NfsStudio }    from './server.studio'
import { 
  type TContext, 
  Spear,
  Router
} from 'tspace-spear'

/**
 * The 'NfsServer' class is a created the server for nfs
 * 
 * @example
 * import { NfsServer } from "tspace-nfs";
import fsSystem from 'fs';
 *
 * new NfsServer()
 * .listen(8000 , ({ port }) => console.log(`Server is running on port http://localhost:${port}`))
 */
class NfsServer extends NfsStudio {

  /**
   * The 'listen' method is used to bind and start a server to a particular port and optionally a hostname.
   * 
   * @param {number} port 
   * @param {function} callback
   * @returns 
   */
  listen(
    port : number, 
    hostname?: string | ((callback: { server: Server; port: number }) => void),
    callback ?: (callback : { server : Server , port : number }) => void
  ) {

    if(arguments.length === 2 && typeof hostname === 'function') {
      callback = hostname
    }

    this._app = new Spear({
      cluster : this._cluster
    })

    this._app.cors({
      origins: ['*'],
      credentials: true
    })

    if(this._logger) {
      this._app.useLogger({
        exceptPath  : /\/benchmark(\/|$)|logs|\/favicon\.ico(\/|$)/
      })
    }
    
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
      router.post('/health-check' ,this._apiHealthCheck)
      router.post('/storage', this._authMiddleware ,this._apiStorage)
      router.post('/file',    this._authMiddleware ,this._apiFile)
      router.post('/folders', this._authMiddleware ,this._apiFolders)
      router.post('/base64',  this._authMiddleware ,this._apiBase64)
      router.post('/stream',  this._authMiddleware ,this._apiStream)
      router.post('/meta',  this._authMiddleware ,this._apiMeta)
      router.post('/remove',  this._authMiddleware ,this._apiRemove)
      router.post('/upload',  this._authMiddleware ,this._apiUpload)
      router.post('/upload/merge',  this._authMiddleware ,this._apiMerge)
      router.post('/upload/base64', this._authMiddleware ,this._apiUploadBase64)
      router.post('/upload/stream',this._authMiddleware , this._apiUploadStream)
    
      return router
    })

    if(this._onStudioCredentials != null) {
      
      this._router.groups('/studio' , (router) => {
        router.get('/' , this.studio)
        router.post('/api/login',this.studioLogin)
        router.put('/api/meta-sync',this._authStudioMiddleware,this.studioMetaSync)
        router.get('/api/storage',this._authStudioMiddleware,this.studioStorage)
        router.get('/preview/*', this._authStudioMiddleware,this.studioPagePreview)
        router.get('/api/preview/*', this._authStudioMiddleware,this.studioPreviewText)
        router.patch('/api/preview/*', this._authStudioMiddleware,this.studioPreviewTextEdit)
        router.delete('/api/logout',this._authStudioMiddleware,this.studioLogout)
        router.get('/api/buckets',this._authStudioMiddleware,this.studioBucket)
        router.post('/api/buckets',this._authStudioMiddleware,this.studioBucketCreate)
        router.post('/api/folders', this._authStudioMiddleware,this.studioCreateFolder)
        router.get('/api/files/*',this._authStudioMiddleware,this.studioFiles)
        router.put('/api/files/*', this._authStudioMiddleware,this.studioEdit)
        router.delete('/api/files/*', this._authStudioMiddleware,this.studioRemove)
        router.post('/api/upload',this._authStudioMiddleware,this.studioUpload)
        router.post('/api/download',this._authStudioMiddleware,this.studioDownload)

        router.get('/shared/*',this.studioPageShared)
        router.get('/api/shared/*',this._authStudioMiddleware,this.studioGetPathShared)

        router.get('/dashboard',this._authStudioMiddleware,this.studioPageDashboard)
        router.get('/api/logs/requests',this._authStudioMiddleware,this.studioLogRequest)
        router.get('/api/logs/monitors',this._authStudioMiddleware,this.studioLogMonitors)
        router.get('/console',this._authStudioMiddleware,this.studioPageConsoleLogs)
        router.get('/api/logs/console/:cid',this._authStudioMiddleware,this.studioConsoleLogs)
        return router
      })
      

    } else {
      this._router.get('/studio' , ({ req , res }) => {
        res.writeHead(403 , { 'Content-Type': 'text/xml'})

        const error = {
          Error : [
              { Code : 'Forbidden' },
              { Message : 'The request was denied by service, Please enable to use studio mode'},
              { Resource : req.url },
          ]
        }

        return res.end(xml([error],{ declaration: true }))
      })
    }
   
    this._router.get('/:bucket/*' , this._media)

    this._app.useRouter(this._router)

    this._app.notfound(({  req , res }) => {

      res.writeHead(404 , { 'Content-Type': 'text/xml'})

      const error = {
        Error : [
            { Code : 'Not found' },
            { Message : 'The request was not found.'},
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

    this._app
    .catch((err : Error , { res } : TContext) => {
      if(this._debug) {
       
        console.log(err)
      }

      return res.status(400)
      .json({
        success : false,
        message : err.message,
        statusCode : 400,
      })
    })

    this._app.listen(port, ({ port , server }) => {

      server.keepAliveTimeout = 1000 * 60;
      server.headersTimeout   = 1000 * 61;

      if(this._buckets != null) {

        cron.schedule('0 0 0 * * *', async () => {
          
          console.clear()

          const buckets : string[] = this._buckets == null ? [] : await this._buckets()
          
          for(const bucket of buckets) {
            this._queue.add(() => this._utils.removeOldDirInTrash(bucket))
          }
        })
      }
     
      this._utils.useHooks(() => {
        if (this._monitors == null) return null;
        return this._monitors({
          host: process.env?.HOSTNAME ?? null,
          cid: this._utils.getContainerId(),
          ...this._utils.cpuAndMemoryUsage()
        });
      }, this._monitorsMs);

      this._utils.useHooks(() => {
        if (this._requestLog == null) return null;
        const requests = [...this._requestLogData];
        this._requestLogData = [];
        return this._requestLog(requests);
      }, this._requestLogMs);

      return callback == null ? null : callback({ port , server })
    })
  }
}

export { NfsServer}
export default NfsServer