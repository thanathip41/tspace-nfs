import { Readable }   from 'stream'
import EventEmitter   from 'events'
import axios          from 'axios'
import FormData       from 'form-data'
import fsSystem       from 'fs'
import http           from 'http'
import https          from 'https'
import bcrypt         from 'bcrypt'
import { Time }       from 'tspace-utils'

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
    private _directory                  = ''
    private _event                      = new EventEmitter()
    private _authorization              = ''
    private _url                        = 'http://localhost:8000'
    private _fileExpired                =  60 * 60
    private _ENDPOINT_CONNECT           = 'connect'
    private _ENDPOINT_REMOVE            = 'remove'
    private _ENDPOINT_FILE              = 'file'
    private _ENDPOINT_FILE_BASE64       = 'base64'
    private _ENDPOINT_FILE_STREAM       = 'stream'
    private _ENDPOINT_STORAGE           = 'storage'
    private _ENDPOINT_FOLDERS           = 'folders'
    private _ENDPOINT_UPLOAD            = 'upload'
    private _ENDPOINT_MERGE             = 'upload/merge'
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
     * The 'default' method is used to default prefix the directory every path
     * 
     * @param   {string} directory
     * @returns {this} 
     */
    default(directory : string): this {

        this._directory = directory

        return this
    }

    /**
     * The 'onError' method is used to handle the error that occurs when trying connect to nfs server
     * 
     * @param   {Function} callback 
     * @returns {this} 
     */
    onError (callback : (err : any , nfs : NfsClient) => void): this {
        this._event.on('error' , callback)
        return this
    }

    /**
     * The 'onConnect' method is used cheke the connection to nfs server
     * 
     * @param   {Function} callback 
     * @returns {this} 
     */
    onConnect (callback : (nfs : NfsClient) => void): this {
        this._event.on('connected' , callback)
        return this
    }

    /**
     * The 'quit' method is used quit the connection and stop the serivce
     * 
     * @returns {never}
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
     * @property {number}   options.expired // expires in seconds
     * @property {number}   options.exists // checks the file exists only
     * @returns  {promise<string>} 
     */
    async toURL (path : string , { download = true , expired , exists = false } : { download?: boolean; expired ?: number; exists ?: boolean } = {}) : Promise<string> {

        try {

            if(exists != null && exists) {

                const url = this._URL(this._ENDPOINT_FILE)

                const response = await this._fetch({
                    url,
                    data : { 
                        path : this._normalizeDefaultDirectory(path),
                        download,
                        expired
                    }
                })
                
                return `${this._url}/${response.data?.endpoint}`
            }

            const fileName = `${path}`.replace(/^\/+/, '')

            const { token , bucket } = this._credentials

            const accessKey  = String(token)
            const expires    = new Time().addSeconds(expired == null || Number.isNaN(Number(expired)) ? this._fileExpired : Number(expired)).toTimeStamp()
            const downloaded = `${Buffer.from(`${expires}@${download}`).toString('base64').replace(/[=|?|&]+$/g, '')}`
            const combined   = `@{${path}-${bucket}-${accessKey}-${expires}-${downloaded}}`
            const signature  = Buffer.from(bcrypt.hashSync(combined , 1)).toString('base64')

            const endpoint = [
                `${bucket}/${fileName}?AccessKey=${accessKey}`,
                `Expires=${expires}`,
                `Download=${downloaded}`,
                `Signature=${signature}`
            ].join('&')
            
            return `${this._url}/${endpoint}`

        } catch (err) {

            return await this._retryConnect(err, async () => {
                return await this.toURL(path , { download , expired , exists })
            })
        }
    }

    /**
     * The 'toBase64' method is used to converts a given file path to base64 encoded
     * 
     * @param    {string}   path 
     * @returns  {promise<string>} 
     */
    async toBase64 (path : string) : Promise<string> {

        try {

            const url = this._URL(this._ENDPOINT_FILE_BASE64)
 
            const response = await this._fetch({
                url,
                data : { 
                    path : this._normalizeDefaultDirectory(path),
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
     * @returns  {Promise<string>} 
     */
    async toStream (path : string , range?: string) : Promise<Readable> {
        try {

            const url = this._URL(this._ENDPOINT_FILE_STREAM)
 
            const response = await this._fetch({
                url,
                data : { 
                    path : this._normalizeDefaultDirectory(path),
                    range 
                },
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
     * The 'upload' method is used uploading file
     * 
     * @param    {object}  obj
     * @property {string}  obj.file
     * @property {string}  obj.name
     * @property {string?} obj.folder
     * @property {number?} obj.chunkSize // unit mb  by default 200 mb
     * @returns  {Promise<{size : number , path : string , name : string , url : string}>} // size is bytes
     */
    async upload ({ file , name , extension , folder , chunkSize } : {
        file      :  string,
        name      :  string,
        extension ?: string
        folder    ?: string
        chunkSize ?: number
    }) : Promise<{ size : number , path : string , name : string , url : string }> {

        const CHUNK_SIZE = 1024 * 1024 * (chunkSize == null ? 200 : chunkSize)
        const stats = fsSystem.statSync(file)
        const fileSize = stats.size
        const totalParts = Math.ceil(fileSize / CHUNK_SIZE)
    
        const fileStream = fsSystem.createReadStream(file, {
            highWaterMark: CHUNK_SIZE
        })
    
        let partNumber = 0

        const files : string[] = []
    
        for await (const chunk of fileStream) {

            partNumber++

            const fileId = Math.random().toString(36).substring(2, 12).replace(/[.@]/g, '')

            const form = new FormData()

            const fileName = `${name.split('.')[0]}_${fileId}@${`0${partNumber}`.slice(-2)}`

            form.append('file', chunk, fileName)

            form.append('folder', this._normalizeDefaultDirectory(folder))

            const url = this._URL(this._ENDPOINT_UPLOAD)

            const response = await this._fetch({
                url,
                data : form,
                type : 'form-data'
            })
            .catch(_ => 'fail to upload file')

            if(response === 'fail to upload file') break

            files.push(fileName)
        }

        if(totalParts !== files.length) {

            for(const file of files) {
                const path = folder == null 
                ? file
                : `${folder}/${file}`
            
                await this.delete(this._normalizeDefaultDirectory(path)).catch(_ => null)
            }

            throw new Error('Could not upload files. Please verify your file and try again.')
        }

        try {

            const response = await this._fetch({
                url : this._URL(this._ENDPOINT_MERGE),
                data : {
                    folder : this._normalizeDefaultDirectory(folder),
                    name : this._normalizeFilename({ name , extension }),
                    paths : files,
                    totalSize : fileSize
                }
            })
    
            const normalizedPath = String(response.data?.path)
            .replace(this._directory,'')
            .replace(/^\/+/, '')

            const file = response.data

            return {
                name : file.name,
                url : await this.toURL(normalizedPath),
                path : normalizedPath,
                size : file.size
            }

        } catch (err) {

            for(const file of files) {
                const path = folder == null ? file : `${folder}/${file}`
                await this.delete(path).catch(_ => null)
            }

            return await this._retryConnect(err, async () => {
                return await this.upload({
                    file,
                    name : this._normalizeFilename({ name , extension }),
                    extension,
                    folder,
                    chunkSize
                })
            })
        }
    }

    /**
     * The 'save' method is used uploading file
     * 
     * @param    {object}  obj
     * @property {string}  obj.file
     * @property {string}  obj.name
     * @property {string?} obj.folder
     * @property {number?} obj.chunkSize // unit mb  by default 200 mb
     * @returns  {Promise<{size : number , path : string , name : string , url : string}>} 
     */
    async save ({ file , name , extension , folder , chunkSize } : {
        file      :  string,
        name      :  string,
        extension ?: string
        folder    ?: string
        chunkSize ?: number
    }) : Promise<{ size : number , path : string , name : string , url : string }> {
        return await this.upload({ file , name , extension , folder , chunkSize })
    }

    /**
     * The 'uploadBase64' method is used uploading file with base64 encoded
     * 
     * @param    {object}  obj
     * @property {string}  obj.base64
     * @property {string}  obj.name
     * @property {string?} obj.folder
     * @returns   {promise<{size : number , path : string , name : string}>} 
     */
      async uploadBase64 ({ base64 , name , extension , folder } : {
        base64    : string,
        name      : string,
        extension ?: string
        folder    ?: string
    }) : Promise<{ size : number , path : string , name : string}> {

        try {

            const url = this._URL(this._ENDPOINT_UPLOAD_BASE64)

            const response = await this._fetch({
                url,
                data : {
                    base64,
                    folder : this._normalizeDefaultDirectory(folder),
                    name : this._normalizeFilename({ name , extension })
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
                    name : this._normalizeFilename({ name , extension }),
                    folder,
                    extension
                })
            })
        }
    }

    /**
     * The 'saveAS' method is used uploading file with base64 encoded
     * 
     * @param    {object}  obj
     * @property {string}  obj.base64
     * @property {string}  obj.name
     * @property {string?} obj.folder
     * @returns  {Promise<{size : number , path : string , name : string}>} 
     */
    async saveAs ({ base64 , name , extension , folder } : {
        base64    : string,
        name      : string,
        extension ?: string
        folder    ?: string
    }) : Promise<{ size : number , path : string , name : string}> {
        return await this.uploadBase64({ base64 , name , extension , folder })
    }

    /**
     * The 'delete' method is used to delete a file
     * 
     * @param    {string}   path 
     * @returns   {promise<string>} 
     */
    async delete (path : string ) : Promise<void> {

        try {

            const url = this._URL(this._ENDPOINT_REMOVE)

            await this._fetch({
                url,
                data : {
                    path : this._normalizeDefaultDirectory(path) 
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
     * The 'remove' method is used to delete a file
     * 
     * @param    {string}   path 
     * @returns  {promise<string>} 
     */
    async remove (path : string ) : Promise<void> {
        return await this.delete(path);
    }

    /**
     * The 'storage' method is used to get information about the storage
     * 
     * @param    {string?}  folder
     * @returns   {Promise<{name : string , size : number }[]>} 
     */
    async storage (folder ?: string ) : Promise<{name : string , size : number }[]> {

       try {

        const url = this._URL(this._ENDPOINT_STORAGE)

        const response = await this._fetch({
            url,
            data : {
                folder : this._normalizeDefaultDirectory(folder) 
            }
        })

        return response.data?.storage ?? []

       } catch (err) {
            return await this._retryConnect(err, async () => {
                return await this.storage(folder)
            })
       }
    }

    /**
     * The 'folders' method is used to get list of folders
     * 
     * @returns {Promise<{name : string , size : number }[]>} 
     */
    async folders () : Promise<{name : string , size : number }[]> {

        try {
 
            const url = this._URL(this._ENDPOINT_FOLDERS)
    
            const response = await this._fetch({
                url,
                data : {}
            })
    
            return response.data?.folders ?? []
 
        } catch (err) {
             return await this._retryConnect(err, async () => {
                 return await this.folders()
             })
        }
    }

    private async _fetch ({ url , data , type = 'json' , method } : { 
        url : string , 
        data : any, 
        type ?: 'form-data' | 'stream' | 'json'
        method ?: string 
    }) : Promise<any> {

        try {

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
                    maxSockets: 100, 
                    maxFreeSockets: 10,
                }),
                httpsAgent: new https.Agent({
                    keepAlive: true,
                    rejectUnauthorized: false,
                    timeout : 0,
                    maxSockets: 100,
                    maxFreeSockets: 10,
                }),
                timeout : 0,
                maxRate : [ Infinity , Infinity],
                responseType : type
            }
    
            return await axios(configs)

        } catch (err : any) {

            const message :string  = err.response?.data?.message || err.message

            if(message.includes('connect ETIMEDOUT')) {
                return await this._fetchReTry({ 
                    url , 
                    data , 
                    type , 
                    error : err , 
                    method,
                    retry : 1
                })
            }

            throw new Error(err.message)
        }
    }

    private async _fetchReTry ({ url , data , type = 'json' , method , error , retry = 1 } : { 
        url : string , 
        data : any, 
        type ?: 'form-data' | 'stream' | 'json'
        method ?: string 
        error : Error
        retry ?: number
    }) : Promise<any> {

        try {

            if(retry > 3) {
                throw error
            }

            await new Promise(ok => setTimeout(ok, (retry**2) * 1500))
            
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
                    maxSockets: 100, 
                    maxFreeSockets: 10,
                }),
                httpsAgent: new https.Agent({
                    keepAlive: true,
                    rejectUnauthorized: false,
                    timeout : 0,
                    maxSockets: 100,
                    maxFreeSockets: 10,
                }),
                timeout : 0,
                maxRate : [ Infinity , Infinity],
                responseType : type
            }
    
            return await axios(configs)

        } catch (err : any) {

            if(retry > 3) {
                return await this._fetchReTry({
                    url,
                    data,
                    type,
                    method,
                    error,
                    retry : retry + 1
                })
            }

            const message  = err.response?.data?.message || err.message

            throw new Error(message)
        }
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
        .then((response: { data: { accessToken: string } }) => {
            this._authorization = response.data?.accessToken
            this._event.emit('connected' , this)
        })
        .catch((err: any) => {

            const message  = err.response?.data?.message || err?.message || 'Server error'

            if(message !== this._TOKEN_EXPIRED_MESSAGE) {
                if(message.includes('connect ECONNREFUSED')) {
                    this._event.emit('error', new Error('Cannot connect to the NFS server, Please try again later.') , this)
                    return
                } 
            }

            this._event.emit('error', new Error(message) , this)
        })

        return
    }

    private async _retryConnect (err : any ,fn : Function) {

        const message  = err.response?.data?.message || err.message

        if(message !== this._TOKEN_EXPIRED_MESSAGE) {
            if(message.includes('connect ECONNREFUSED')) {
                throw new Error('Cannot connect to the NFS server, Please try again later.')
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

            throw new Error('Failed to connect to nfs server, Please check your credentials and try again.')
        }
    }

    // private async _upload (form : FormData) : Promise<{ size : number , path : string , name : string , url : string }> {

    //     try {

    //         const url = this._URL(this._ENDPOINT_UPLOAD)

    //         const response = await this._fetch({
    //             url,
    //             data : form,
    //             type : 'form-data'
    //         })

    //         return response

    //     } catch (e) {

    //     }
       
    // }

    private _normalizeFilename ({ name , extension } : { name : string , extension ?: string | null }): string {

        return extension == null 
          ?  name
          : `${name.split('.')[0]}.${extension}`
    }

    private _normalizeDefaultDirectory (directory ?: string | null): string {

        if(directory == null) {
            return this._directory === '' 
            ? this._directory 
            : this._directory.replace(/\/\//g, "/")
        }

        const normalized = (
            this._directory === ''   
            ? directory
            :`${this._directory}/${directory}`
        ).replace(/\/\//g, "/")

        return normalized
    }
}

export { NfsClient }
export default NfsClient 