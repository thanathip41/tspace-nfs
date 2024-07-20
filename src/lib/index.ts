/**
* The entry point.
*
* @module tspace-nfs
*/
import NfsClient from './client'
import NfsServer from './server'

export *  from './client'
export *  from './server'

export default {
  Client : NfsClient, 
  Server : NfsServer
}