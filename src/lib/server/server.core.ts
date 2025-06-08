import { 
  Spear,
  Router
} from 'tspace-spear'
import { Queue } from './server.queue'
import { Utils } from '../utils'

type TMonitors = { 
  host : string | null; 
  memory : {  
    total : number; 
    heapTotal : number;
    heapUsed: number ;
    external : number ; 
    rss : number;
  },
  cpu : { 
    total : number;
    max: number;
    min: number;
    avg: number;
    speed: number; 
  }
}

type TCredentials = { 
  token : string; 
  secret : string; 
  bucket : string;
}

type TLoginCrentials = {
  username : string; 
  password : string;
}

class NfsServerCore {

  protected _buckets                  !: Function | null
  protected _credentials              !: ({ token , secret , bucket } : TCredentials) => Promise<boolean> | null
  protected _onStudioBucketCreated    ?: ({ bucket , secret , token } : TCredentials) => Promise<void> | null
  protected _onStudioCredentials      ?: ({ username, password } : TLoginCrentials) => Promise<{ logged : boolean , buckets : string[] }> | null
  protected _onLoadBucketCredentials  ?: () => Promise<TCredentials[]>
  protected _monitors                 ?: ({ host, memory , cpu } : TMonitors) => Promise<void>

  protected _queue          = new Queue(3)
  protected _app            !: Spear
  protected _router         !: Router 
  protected _html           !: string | null
  protected _fileExpired    : number = 60 * 60
  protected _rootFolder     : string = 'nfs'
  protected _jwtExipred     : number = 60 * 60
  protected _jwtSecret      : string = `<secret@${+new Date()}:${Math.floor(Math.random() * 9999)}>`
  protected _cluster        : boolean | number = false
  protected _progress       : boolean = false
  protected _debug          : boolean = false
  protected _trash          : string = '@Recycle bin'
  protected _metadata       : string = '@meta.json'

  protected _utils          = new Utils(
    this._buckets,
    this._rootFolder, 
    this._metadata,
    this._trash
  )
  
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
   * The 'onBucketLists' method is used to inform the server about the available bucket lists.
   * 
   * @param    {function} callback
   * @returns  {this}
   */
  onLoadBucketLists (callback : () => Promise<string[]>) : this {

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
   * The 'onMonitors' is method used to monitors the server.
   * 
   * @param    {function} callback
   * @property {string} callback.host
   * @property {object} callback.memory
   * @property {object} callback.cpu
   * @returns  {this}
   */
  onMonitors (callback : ({ host, memory , cpu } : { 
    host : string | null 
    memory : { 
      total     : number // total
      heapTotal : number // MB
      heapUsed  : number // MB
      rss       : number // MB
      external  : number // MB
    }  
    cpu :  {
      total : number // total
      max   : number // %
      min   : number // %
      avg   : number // %
      speed : number // GHz
    }
  }) => Promise<void>) : this {

    this._monitors = callback

    return this

  } 

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
    onLoadBucketCredentials
  } : {
    onCredentials   : (({ username, password }: { username: string; password: string }) => Promise<{ logged: boolean; buckets: string[] }>)
    onBucketCreated ?: (({ token, secret, bucket }: { token: string; secret: string; bucket: string }) => Promise<void>),
    onLoadBucketCredentials ?: (() => Promise<{ bucket : string , token : string , secret : string}[]>)
  }): this {

    this._onStudioCredentials = onCredentials
    this._onStudioBucketCreated = onBucketCreated
    this._onLoadBucketCredentials = onLoadBucketCredentials

    // creating file meta for any buckets
    this._utils.syncMetadata('*')

    return this;
  }
}

export { NfsServerCore }
export default NfsServerCore 