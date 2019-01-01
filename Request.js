const Dia = require ('./Dia.js')
const url  = require ('url')

module.exports = class Request {

    constructor (o) {
        this.uuid = Dia.new_uuid ()
        for (i in o) this [i] = o [i]
        this.get_params ()
    }    
    
    get_params () {
        let rq = this.http_request
        if (rq) this.get_http_params (rq)
    }

    get_http_params (rq) {
        let uri = url.parse (rq.url)
        let params = new URLSearchParams (uri.search);
        this.q = {}
        for (var k of ['type', 'id', 'action', 'part']) if (params.has (k)) this.q [k] = params.get (k)
    }
    
    out_json (code, data) {
        let rp = this.http_response
        rp.statusCode = code
        rp.setHeader ('Content-Type', 'application/json')
        rp.end (JSON.stringify (data))
    }
    
}