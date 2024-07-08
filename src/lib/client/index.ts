import EventEmitter     from 'events'
import axios            from 'axios'
import FormData         from 'form-data'
import fs               from 'fs'

class NfsClient {
    private _authorization : string     = ''
    private _event                      = new EventEmitter()
    private _url                        = 'http://localhost:8000'
    private _endpointConnect            = '/connect'
    private _endpointUpload             = '/upload'
    private _endpointFile               = '/file'
    private _endpointFileBase64         = '/base64'
    private _endpointFileStream         = '/stream'
    private _endpointStorage            = '/storage'

    private _credentials = {
        token : '',
        secret : '',
        bucket : ''
    }

    constructor({
        token,
        secret,
        bucket,
        url
    } : { token : string; secret : string; bucket : string; url : string}) {

        this._credentials = {
            token,
            secret,
            bucket
        }

        this._url = url
       
        this._getConnect(this._credentials)
    }

    onError (callback : (err : any , self : NfsClient) => void) {
        this._event.on('error' , callback)
        return this
    }

    onConnect (callback : (self : NfsClient) => void) {
        this._event.on('connected' , callback)
        return this
    }

    on (event : 'connected' | 'error' , callback : (...args: any[]) => void) {
        this._event.on(event , callback)
        return this
    }

    async toURL (path : string , { download = true } = {}) : Promise<string> {
       try {
            const url = this._URL(this._endpointFile)

            const response = await axios({
                url,
                method : 'POST',
                data : { 
                    path,
                    download
                },
                headers : {
                    authorization : `Bearer ${this._authorization}`
                }
            })

            return `${this._url}/${response.data?.endpoint}`

       } catch (err : any) {

            const message  = err.response?.data?.message || err.message

            if(message === 'jwt expired') {

                await this._retryConnect()

                return await this.toURL(path)
            }

            throw new Error(message)
       }
    }

    async toBase64 (path : string) : Promise<string> {
        try {
             const url = this._URL(this._endpointFileBase64)
 
             const response = await axios({
                url,
                method : 'POST',
                data : { 
                    path 
                },
                headers : {
                    authorization : `Bearer ${this._authorization}`
                }
            })

            return response.data?.base64
 
        } catch (err : any) {
 
             const message  = err.response?.data?.message || err.message
 
             if(message === 'jwt expired') {
 
                 await this._retryConnect()
 
                 return await this.toURL(path)
             }
 
             throw new Error(message)
        }
    }

    async toStream (path : string , range?: string) : Promise<any> {
        try {
             const url = this._URL(this._endpointFileStream)
 
             const response = await axios({
                method: 'post',
                url,
                headers : {
                    authorization : `Bearer ${this._authorization}`,
                },
                data : { path , range },
                responseType: 'stream',
            });

            return response.data
 
        } catch (err : any) {
 
             const message  = err.response?.data?.message || err.message
 
             if(message === 'jwt expired') {
 
                 await this._retryConnect()
 
                 return await this.toStream(path)
             }
             
             throw new Error(message)
        }
    }

    async upload ({ directory , name , folder } : {
        directory : string,
        name      : string,
        folder    ?: string
    }) : Promise<void> {

        try {

            const url = this._URL(this._endpointUpload)

            const data = new FormData();

            data.append('file', fs.createReadStream(directory), name)

            data.append('folder', folder == null ? '' : folder)
        
            await axios({
                method: 'POST',
                maxBodyLength: Infinity,
                url,
                headers: { 
                    authorization : `bearer ${this._authorization}`, 
                    ...data.getHeaders()
                },
                data : data
            })

            return 

        } catch (err : any) {

            throw new Error(err.response?.data?.message || err.message)
        }
    }

    async storage (folder ?: string ) : Promise<{name : string , size : number }[]> {

        try {

            const url = this._URL(this._endpointStorage)

            const response = await axios({
                url,
                data : {
                    folder
                },
                method : 'POST',
                headers : {
                    authorization : `Bearer ${this._authorization}`
                }
            })

            return response.data?.storage ?? []

        } catch (err : any) {
            throw new Error(err.response?.data?.message || err.message)
        }
    }



    quit () {
        return process.exit(0)
    }

    private async _retryConnect() {
        
        const response = await axios.request({
            url : this._URL(this._endpointConnect),
            data : { 
                ...this._credentials
            }
        })

        this._authorization = response.data?.accessToken

        return
    }

    private _URL (endpoint : string) {

        return `${this._url}${endpoint}`
    }

    private _getConnect({
        token,
        secret,
        bucket
    } : { token : string; secret : string; bucket : string}) {

        axios.post(`${this._url}${this._endpointConnect}`, { 
            token,
            secret,
            bucket
        })
        .then((response: { data: { accessToken: any } }) => {
            this._event.emit('connected' , this)
            this._authorization = response.data?.accessToken
        })
        .catch((err: any) => {
            this._event.emit('error', err.response?.data ?? err , this)
        })
    }
}

export { NfsClient }
export default NfsClient 