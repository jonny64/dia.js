const Dia = require ('../../Dia.js')

module.exports = class extends Dia.DB.Client {

    async release () {
        return await this.backend.release ()
    }
    
    fix_sql (original_sql) {    
        let parts = original_sql.split ('?')
        let sql = parts.shift ()
        let cnt = 0
        for (let part of parts) sql += `$${++cnt}${part}`        
        return sql    
    }

    async select_all (original_sql, params = []) {
    
        let sql = this.fix_sql (original_sql)
        
        let label = sql + ' ' + JSON.stringify (params)
        
        console.time (label)
        
        try {
            let result = await this.backend.query (sql, params)
            return result.rows
        }
        finally {
            console.timeEnd (label)
        }
        
    }
    
    async select_hash (sql, params) {
        let all = await this.select_all (sql, params)
        return all.length ? all [0] : {}
    }
    
    async select_scalar (sql, params) {
        let r = await this.select_hash (sql, params)
        for (let k in r) return r [k]
        return null
    }    

}