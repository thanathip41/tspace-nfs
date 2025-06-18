import xml          from 'xml'
import cron         from 'node-cron'
import { Server }   from 'http'
import os           from 'os'
import { 
  type TContext, 
  Spear,
  Router
} from 'tspace-spear'
import { NfsStudio } from './server.studio'

/**
 * The 'NfsServer' class is a created the server for nfs
 * 
 * @example
 * import { NfsServer } from "tspace-nfs";
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
  listen(port:number, callback ?: ({ port , server } : { port : number , server : Server }) => void) {

    this._app = new Spear({
      cluster : this._cluster
    })

    this._app.cors({
      origins: ['*'],
      credentials: true
    })

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
        router.get('/api/storage',this._authStudioMiddleware,this.studioStorage)
        router.get('/preview/*', this._authStudioMiddleware,this.studioPreview)
        router.get('/api/preview/*', this._authStudioMiddleware,this.studioPreviewText)
        router.patch('/api/preview/*', this._authStudioMiddleware,this.studioPreviewTextEdit)
        router.delete('/api/logout',this._authStudioMiddleware,this.studioLogout)
        router.get('/api/buckets',this._authStudioMiddleware,this.studioBucket)
        router.post('/api/buckets',this._authStudioMiddleware,this.studioBucketCreate)
        router.get('/api/files/*',this._authStudioMiddleware,this.studioFiles)
        router.put('/api/files/*', this._authStudioMiddleware,this.studioEdit)
        router.delete('/api/files/*', this._authStudioMiddleware,this.studioRemove)
        router.post('/api/upload',this._authStudioMiddleware,this.studioUpload)
        router.post('/api/download',this._authStudioMiddleware,this.studioDownload)
        router.get('/shared/*',this.studioShared)
        router.get('/api/shared/*',this._authStudioMiddleware,this.studioGetPathShared)
 
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

    this._app
    .catch((err : Error , { req , res } : TContext) => {

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

      if(this._buckets != null) {

        cron.schedule('0 0 0 * * *', async () => {
          
          console.clear()

          const buckets : string[] = this._buckets == null ? [] : await this._buckets()
          
          for(const bucket of buckets) {
            this._queue.add(() => this._utils.removeOldDirInTrash(bucket))
          }
        })
      }
     
      if(this._monitors != null) {

        try {

          const logCpuAndMemoryUsage = () => {

            const memoryUsage = process.memoryUsage();
  
            const totalMemory = os.totalmem();
  
            const cpus = os.cpus();
  
            const usageData = cpus.map(cpu => {
              const total = Object.values(cpu.times).reduce((acc, time) => acc + time, 0);
              const active = total - cpu.times.idle;
              return (active / total) * 100;
            });
        
            const overallMax = Number(Number(Math.max(...usageData)).toFixed(4))
            const overallMin = Number(Number(Math.min(...usageData)).toFixed(4))
            const overallAvg = Number(Number(usageData.reduce((acc, usage) => acc + usage, 0) / usageData.length).toFixed(4))
                
            if(this._monitors != null) {

              const toMB = (v : any) =>  Number(Number(v / 1024 / 1024).toFixed(4))

              this._monitors({
                host : process.env?.HOSTNAME == null ? null : String(process.env?.HOSTNAME),
                memory:  {
                  total     :toMB(totalMemory),
                  heapTotal : toMB(memoryUsage.heapTotal),
                  heapUsed  : toMB(memoryUsage.heapUsed),
                  external  : toMB(memoryUsage.external),
                  rss       : toMB(memoryUsage.rss)
                } ,
                cpu : {
                  total : cpus.length,
                  max   : overallMax,
                  min   : overallMin,
                  avg   : overallAvg,
                  speed : cpus
                  .map((cpu) => cpu.speed / 1000)
                  .reduce((acc, usage) => acc + usage, 0) / cpus.length
                }
              })
            }
          }
  
          setInterval(logCpuAndMemoryUsage, 5_000)

        } catch (e) {}
      }

      return callback == null ? null : callback({ port , server })
    })
  }
}

export { NfsServer}
export default NfsServer