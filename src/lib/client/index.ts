import EventEmitter   from 'events'
import axios          from 'axios'
import FormData       from 'form-data'
import fsSystem       from 'fs'
import http           from 'http'
import https          from 'https'

/**
 * 
 * The 'NfsClient' class is a client for nfs server
 * @example
 * import { NfsClient } from "tspace-nfs";
 * import PathSystem from 'path';
 * import pathSystem from 'path';
 *
 *   const nfs = new NfsClient({
 *      token     : '<YOUR TOKEN>',   // token
 *      secret    : '<YOUR SECRET>',  // secret
 *      bucket    : '<YOUR BUCKET>',  // bucket name
 *      url       : '<YOUR URL>'      // https://nfs-server.example.com
 *   })
 *   .onError((err, nfs) => {
 *      console.log('nfs client failed to connect')
 *      console.log(err.message)
 *      nfs.quit()
 *   })
 *   .onConnect((nfs) => {
 *      console.log('nfs client connected')
 *   })
 * 
 *   const mycat = 'cats/my-cat.png'
 *   const url   = await nfs.toURL(mycat)
 * 
 *   console.log(url)
 */
class NfsClient {
    private _event                      = new EventEmitter()
    private _authorization              = ''
    private _url                        = 'http://localhost:8000'
    private _ENDPOINT_CONNECT           = 'connect'
    private _ENDPOINT_UPLOAD            = 'upload'
    private _ENDPOINT_MERGE             = 'merge'
    private _ENDPOINT_REMOVE            = 'remove'
    private _ENDPOINT_FILE              = 'file'
    private _ENDPOINT_FILE_BASE64       = 'base64'
    private _ENDPOINT_FILE_STREAM       = 'stream'
    private _ENDPOINT_STORAGE           = 'storage'
    private _ENDPOINT_UPLOAD_BASE64     = 'upload/base64'
    private _TOKEN_EXPIRED_MESSAGE      = 'Token has expired'

    private _credentials = {
        token : '',
        secret : '',
        bucket : ''
    }

    constructor({ token, secret, bucket, url } : { 
        token  : string; 
        secret : string; 
        bucket : string;
        url    : string;
    }) {

        this._credentials = {
            token,
            secret,
            bucket
        }

        this._url = url
       
        this._getConnect(this._credentials)
    }

    /**
     * The 'onError' method is used to handle the error that occurs when trying connect to nfs server
     * 
     * @param {Function} callback 
     * @returns {this} 
     */
    onError (callback : (err : any , nfs : NfsClient) => void): this {
        this._event.on('error' , callback)
        return this
    }

    /**
     * The 'onConnect' method is used cheke the connection to nfs server
     * 
     * @param {Function} callback 
     * @returns {this} 
     */
    onConnect (callback : (nfs : NfsClient) => void): this {
        this._event.on('connected' , callback)
        return this
    }

    /**
     * The 'quit' method is used quit the connection and stop the serivce
     * 
     * @return {never}
     */
    quit () : never {
        return process.exit(0)
    }

    /**
     * The 'toURL' method is used to converts a given file path to a URL
     * 
     * @param    {string}   path 
     * @param    {object}   options
     * @property {boolean}  options.download
     * @return   {promise<string>} 
     */
    async toURL (path : string , { download = true } : { download?: boolean } = {}) : Promise<string> {

        try {

            const url = this._URL(this._ENDPOINT_FILE)

            const response = await this._fetch({
                url,
                data : { 
                    path,
                    download
                }
            })

            return `${this._url}/${response.data?.endpoint}`

        } catch (err) {

            return await this._retryConnect(err, async () => {
                return await this.toURL(path , { download })
            })
        }
    }

    /**
     * The 'toBase64' method is used to converts a given file path to base64 encoded
     * 
     * @param    {string}   path 
     * @return   {promise<string>} 
     */
    async toBase64 (path : string) : Promise<string> {

        try {

            const url = this._URL(this._ENDPOINT_FILE_BASE64)
 
            const response = await this._fetch({
                url,
                data : { 
                    path 
                }
            })

            return response.data?.base64 ?? ''

        } catch (err) {
            return await this._retryConnect(err, async () => {
                return await this.toBase64(path)
            })
        }
    }

    /**
     * The 'toStream' method is used to converts a given file path to stream format
     * 
     * @param    {string}   path 
     * @param    {string?}   range
     * @return   {promise<string>} 
     */
    async toStream (path : string , range?: string) : Promise<any> {
        try {

            const url = this._URL(this._ENDPOINT_FILE_STREAM)
 
            const response = await this._fetch({
                url,
                data : { path , range },
                type : 'stream'
            })

            return response.data

        } catch (err) {

            return await this._retryConnect(err, async () => {
                return await this.toStream(path , range)
            })
        }
    }

    /**
     * The 'upload' method is used uploading file with base64 encoded
     * 
     * @param    {object}  obj
     * @property {string}  obj.base64
     * @property {string}  obj.name
     * @property {string?} obj.folder
     * @return   {promise<{size : number , path : string , name : string}>} 
     */
    async uploadBase64 ({ base64 , name , folder } : {
        base64    : string,
        name      : string,
        folder    ?: string
    }) : Promise<{ size : number , path : string , name : string}> {

        try {

            const url = this._URL(this._ENDPOINT_UPLOAD_BASE64)

            const response = await this._fetch({
                url,
                data : {
                    base64,
                    folder,
                    name
                }
            })

            return {
                url : await this.toURL(response.data?.path),
                ...response.data,
            }

        } catch (err) {

            return await this._retryConnect(err, async () => {
                return await this.uploadBase64({
                    base64,
                    name,
                    folder
                })
            })
        }
    }

    /**
     * The 'upload' method is used uploading file
     * 
     * @param    {object}  obj
     * @property {string}  obj.file
     * @property {string}  obj.name
     * @property {string?} obj.folder
     * @property {number?} obj.chunkSize // mb size
     * @return   {promise<{size : number , path : string , name : string}>} 
     */
    async upload ({ file , name , folder , chunkSize } : {
        file      : string,
        name      : string,
        folder    ?: string
        chunkSize ?: number
    }) : Promise<{ size : number , path : string , name : string }> {

        const CHUNK_SIZE = 1024 * 1024 * (chunkSize == null ? 200 : chunkSize)
        const stats = fsSystem.statSync(file)
        const fileSize = stats.size;
        const totalParts = Math.ceil(fileSize / CHUNK_SIZE)
    
        const fileStream = fsSystem.createReadStream(file, {
            highWaterMark: CHUNK_SIZE,
        })
    
        let partNumber = 0;

        const files : string[] = []
    
        for await (const chunk of fileStream) {

            partNumber++

            const fileId = Math.random().toString(36).substring(2, 12).replace(/\./g,'')

            const form = new FormData()

            const fileName = `${name.split('.')[0]}_${fileId}@${`0${partNumber}`.slice(0,2)}`

            form.append('file', chunk, fileName)

            form.append('folder', folder == null ? '' : folder)

            const url = this._URL(this._ENDPOINT_UPLOAD)

            const response = await this._fetch({
                url,
                data : form,
                type : 'form-data'
            })
            .catch(_ => null)

            if(response == null) break

            files.push(fileName)
        }

        if(totalParts !== files.length) {

            for(const file of files) {
                const path = folder == null ? file : `${folder}/${file}`
                await this.delete(path).catch(_ => null)
            }

            throw new Error('Could not upload files. Please verify your file and try again.')
        }

        try {

            const response = await this._fetch({
                url : this._URL(this._ENDPOINT_MERGE),
                data : {
                    folder,
                    name,
                    paths : files
                }
            })
    
            return {
                url : await this.toURL(response.data?.path),
                ...response.data,
            }

        } catch (err) {

            for(const file of files) {
                const path = folder == null ? file : `${folder}/${file}`
                await this.delete(path).catch(_ => null)
            }

            throw err
        }
    }

    /**
     * The 'delete' method is used to delete a file
     * 
     * @param    {string}   path 
     * @return   {promise<string>} 
     */
    async delete (path : string ) : Promise<void> {

        try {

            const url = this._URL(this._ENDPOINT_REMOVE)

            await this._fetch({
                url,
                data : {
                    path
                }
            })

            return

        } catch (err) {

            return await this._retryConnect(err, async () => {
                return await this.delete(path)
            })
        }
    }

    /**
     * The 'storage' method is used to get information about the storage
     * 
     * @param    {string?}  folder
     * @return   {Promise<{name : string , size : number }[]>} 
     */
    async storage (folder ?: string ) : Promise<{name : string , size : number }[]> {

       try {

        const url = this._URL(this._ENDPOINT_STORAGE)

        const response = await this._fetch({
            url,
            data : {
                folder
            }
        })

        return response.data?.storage ?? []

       } catch (err) {
            return await this._retryConnect(err, async () => {
                return await this.storage(folder)
            })
       }
    }

    private async _fetch ({ url , data , type , method } : { 
        url : string , 
        data : any, 
        type ?: 'form-data' | 'stream'
        method ?: string 
    }) : Promise<any> {

        let headers = {
            authorization : `Bearer ${this._authorization}`,
            Connection: 'keep-alive'
        }

        if(type === 'form-data') {
            headers = {
                ...headers,
                ...data.getHeaders()
            }
        }

        const configs : Record<string,any> = {
            url,
            data,
            headers,
            method : method == null ? 'POST' : method,
            maxBodyLength: Infinity,
            maxContentLength: Infinity,
            httpAgent : new http.Agent({
                keepAlive: true,
                timeout : 0,
                
            }),
            httpsAgent: new https.Agent({
                keepAlive: true,
                rejectUnauthorized: false,
                timeout : 0
            }),
            timeout : 0
        }

        if(type === 'stream') {
            configs['responseType'] = 'stream'
        }

        return await axios(configs)
    }

    private _URL (endpoint : string) : string {

        return `${this._url}/api/${endpoint}`
    }

    private _getConnect({
        token,
        secret,
        bucket
    } : { token : string; secret : string; bucket : string}) : void {

        const url = this._URL(this._ENDPOINT_CONNECT)

        axios.post(url, { 
            token,
            secret,
            bucket
        })
        .then((response: { data: { accessToken: any } }) => {
            this._authorization = response.data?.accessToken
            this._event.emit('connected' , this)
        })
        .catch((err: any) => {
            this._event.emit('error', err.response?.data ?? err , this)
        })

        return
    }

    private async _retryConnect (err : any ,fn : Function) {

        const message  = err.response?.data?.message || err.message

        if(message !== this._TOKEN_EXPIRED_MESSAGE) {
            if(message.includes('connect ECONNREFUSED')) {
                throw new Error('Cannot connect to the NFS server. Please try again later.')
            }
            throw new Error(message) 
        }

        try {

            const response = await axios({
                url : this._URL(this._ENDPOINT_CONNECT),
                data : { 
                    ...this._credentials
                },
                method : 'POST'
            })
            
            this._authorization = response.data?.accessToken
    
            return await fn()

        } catch (err : any) {

            const message  = err.response?.data?.message || err.message

            throw new Error(message)
        }
    
    }
}

export { NfsClient }
export default NfsClient 