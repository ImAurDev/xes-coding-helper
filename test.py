# uncompyle6 version 3.8.0
# Python bytecode 3.7.0 (3394)
# Decompiled from: Python 3.8.5 (tags/v3.8.5:580fbb0, Jul 20 2020, 15:57:54) [MSC v.1924 64 bit (AMD64)]
# Embedded file name: build\Lib\site-packages\thonny\handle_http.py
# Compiled at: 2022-12-29 15:08:18
# Size of source mod 2**32: 12184 bytes
from urllib.parse import urlparse, parse_qs, unquote
from thonny.download_asset import copy_all_files, get_local_path
from thonny.log import push_log, Type
from thonny.common import cache_path, clear_assets
from flask import Flask, request, Response, send_file
from flask_cors import CORS
import thonny, traceback
from thonny.manage_package import pkg_manager, State
from thonny.lib_list import pack_list
import json
from flask.logging import default_handler
import thonny.dict_manager as dm
from thonny.download_asset import AssetManage, Response
from thonny.auto_complete import autocomplete, handle_prepload
from thonny.logger import xes_logger
import time, os
from threading import Thread
app = Flask(__name__)
app.debug = False
app.logger.disabled = True
app.logger.removeHandler(default_handler)
app.config['JSON_AS_ASCII'] = False
CORS(app)
response_dict = {}
last_code = ''
last_time = int(time.time())
_can_auto_complete = False
_has_complete_preloaded = False
try:
    from xesrepair.complete_filter import OUT_TIME_SECONDS
except:
    OUT_TIME_SECONDS = 10

def send_form_res(status=200, msg='', status_code=None):
    res = {}
    if status == 200:
        res['data'] = msg
        return json.dumps(res, default=(lambda obj: obj.__dict__), sort_keys=True, ensure_ascii=False, indent=4)
    else:
        res['message'] = msg
        if status_code is None:
            res['status_code'] = status
        else:
            res['status_code'] = status_code
    return (
     json.dumps(res, default=(lambda obj: obj.__dict__), sort_keys=True, ensure_ascii=False, indent=4), status)


@app.route('/')
def handle_path():
    try:
        path = request.args.get('path')
        abs_src_dir = os.path.join(path, 'code_assets')
        if not os.path.exists(abs_src_dir):
            err_msg = 'code_assets�ļ��в�����'
            push_log(Type.LOG, 0, err_msg)
            return send_form_res(400, err_msg)
        dst_dir = os.path.join(cache_path, 'asset_pool')
        if not os.path.exists(dst_dir):
            os.makedirs(dst_dir)
        result = copy_all_files(abs_src_dir, dst_dir)
        if result == True:
            return send_form_res(200, 'Success')
        err_msg = 'Ԥ���ؿ����ļ�ʧ�� '
        push_log(Type.LOG, 0, err_msg + str(result))
        return send_form_res(400, err_msg)
    except Exception as e:
        try:
            err_msg = '���Ϸ�������'
            push_log(Type.LOG, 0, err_msg + str(e))
            return send_form_res(400, err_msg)
        finally:
            e = None
            del e


@app.route('/ping')
def ping():
    try:
        res = {'auto': True}
        import platform
        if platform.system() != 'Darwin':
            from thonny.url_protocol_win import has_written_register
            is_written = has_written_register()
            res = is_written or {'auto': False}
        else:
            from thonny.common import is_client_call
            if is_client_call():
                res = {'auto': False}
        return send_form_res(200, res)
    except Exception as e:
        try:
            push_log(Type.LOG, 0, 'http /ping err:' + str(e))
            xes_logger.sendLog({'clickname':'http', 
             'click_value':'/ping', 
             'errmsg':str(e)})
            return send_form_res(200, {'auto': False})
        finally:
            e = None
            del e


@app.route('/version')
def get_version():
    local_cf = thonny.get_local_cf()
    try:
        version = local_cf['info']['version']
        return send_form_res(200, {'version': version})
    except Exception as e:
        try:
            push_log(Type.LOG, 0, str(e))
            return send_form_res(400, str(e))
        finally:
            e = None
            del e


@app.route('/path', methods=['POST'])
def get_path():
    package_info = request.get_data().decode(encoding='utf-8')
    args = json.loads(package_info)
    if 'id' in args:
        pid = 6
        if 'message' not in args:
            return send_form_res(400, 'ȱ����Դ��Ϣ')
        else:
            am = AssetManage()
            ass_res = am.handle_assets_json(args['message'])
            if not ass_res.OK:
                return send_form_res(400, '��Դ����ʧ��')
            if 'project_id' in args:
                pid = args['project_id']
            res = get_local_path(pid, args['id'])
            return res or send_form_res(404, '��Դ������')
        from thonny.port_helper import get_port
        return send_form_res(200, {'path': 'http://127.0.0.1:' + str(get_port() + 4) + '/' + res})
    else:
        return send_form_res(404, '��Դ������')


DefaultPic = 'https://ss1.bdstatic.com/70cFvXSh_Q1YnxGkpoWK1HF6hhy/it/u=2018939532,1617516463&fm=26&gp=0.jpg'

@app.route('/package/search', methods=['GET'])
def search_pkg():
    search_args = dict(request.args)
    if 'name' in search_args:
        exact_flag = False
        if 'exact_flag' in search_args:
            exact_flag = True
        try:
            res = pack_list.search_handler(search_args['name'], exact_flag)
        except Exception as e:
            try:
                xes_logger.sendLog({'clickname':'http', 
                 'click_value':request.args, 
                 'errmsg':str(e)})
                return send_form_res(400, str(e))
            finally:
                e = None
                del e

        return send_form_res(200, res)
    return send_form_res(400, '�����ѯ����')


@app.route('/package/local')
def get_list():
    local_args = dict(request.args)
    page_id = ''
    if 'page_id' in local_args:
        page_id = local_args['page_id']
    msg = pack_list.get_pack_list(page_id)
    if msg is False:
        return send_form_res(400, '�ù��ܱ�����', 1001)
    return send_form_res(200, msg)


@app.route('/package/err')
def get_err():
    msg = pack_list.get_err_list()
    return send_form_res(200, msg)


@app.route('/package/clear', methods=['POST'])
def clear():
    try:
        res = clear_assets()
        return send_form_res(200, 'success')
    except Exception as e:
        try:
            return send_form_res(400, str(e))
        finally:
            e = None
            del e


@app.route('/package/err/delete', methods=['POST'])
def remove_pkg():
    package_info = request.get_data().decode(encoding='utf-8')
    req_args = json.loads(package_info)
    if 'name' not in req_args:
        send_form_res(400, 'ȱ�ٲ���')
    pack_list.remove_err_pack(req_args['name'])
    return send_form_res(msg='Delete Success')


@app.route('/package/install', methods=['POST'])
def install_pkg():
    package_info = request.get_data().decode(encoding='utf-8')
    req_args = json.loads(package_info)
    be_first = False
    version = 1.0
    desc = ''
    page_id = ''
    tag = None
    if 'name' not in req_args:
        send_form_res(400, 'ȱ�ٲ���')
    if 'first' in req_args:
        be_first = True
    if 'version' in req_args:
        version = req_args['version']
    if 'desc' in req_args:
        desc = req_args['desc']
    if 'page_id' in req_args:
        page_id = req_args['page_id']
    if 'tag' in req_args:
        tag = req_args['tag']
    res = pack_list.install_handler(name=(req_args['name']),
      page_id=page_id,
      version=version,
      desc=desc,
      first=be_first,
      tag=tag)
    if res is False:
        return send_form_res(400, '�ù��ܱ�����', 1001)
    return send_form_res(msg={'state': res})


@app.route('/package/uninstall', methods=['POST'])
def uninstall_pkg():
    package_info = request.get_data().decode(encoding='utf-8')
    req_args = json.loads(package_info)
    if 'name' not in req_args:
        send_form_res(400, 'ȱ�ٲ���')
    pack_list.uninstall_handler(req_args['name'])
    return send_form_res(msg='Uninstall Success')


@app.route('/package/cancel', methods=['POST'])
def cancel_install_pkg():
    package_info = request.get_data().decode(encoding='utf-8')
    req_args = json.loads(package_info)
    if 'name' not in req_args:
        send_form_res(400, 'ȱ�ٲ���')
    pre_state = pack_list.cancel_install_handler(req_args['name'])
    return send_form_res(200, msg={'state': pre_state})


@app.route('/package/state')
def get_state():
    args = dict(request.args)
    pre = ''
    if 'pre' in args:
        pre = args['pre']
    data = pack_list.get_state(pre, True)
    return send_form_res(msg=data)


@app.route('/package/all_state')
def get_all_state():
    global _can_auto_complete
    global _has_complete_preloaded
    local_args = dict(request.args)
    page_id = ''
    if 'page_id' in local_args:
        page_id = local_args['page_id']
    data = pack_list.get_all_state(page_id)
    if data is False:
        return send_form_res(400, '�ù��ܱ�����', 1001)
    if data['all_state'] == State.installing.value:
        _can_auto_complete = False
    else:
        if not _has_complete_preloaded:
            Thread(target=handle_prepload, daemon=False).start()
            _has_complete_preloaded = True
        _can_auto_complete = True
    return send_form_res(msg=data)


@app.route('/package/unlock', methods=['POST'])
def unlock():
    raw_data = request.get_data().decode(encoding='utf-8')
    req_args = json.loads(raw_data)
    page_id = ''
    if 'page_id' in req_args:
        page_id = req_args['page_id']
    pack_list.unlock(page_id)
    return send_form_res(msg='ok')


@app.route('/package/mirrors')
def get_mirrors():
    return send_form_res(msg=(pkg_manager.get_mirrors()))


@app.route('/package/mirrors/choose', methods=['POST'])
def choose_mirror():
    raw_data = request.get_data().decode(encoding='utf-8')
    req_args = json.loads(raw_data)
    if 'index' in req_args:
        index = req_args['index']
        pkg_manager.choose_mirror(index)
        return send_form_res(msg='ok')
    send_form_res(400, 'ȱ�ٲ���')


@app.route('/assets/dict')
def open_file():
    local_args = dict(request.args)
    if 'id' in local_args:
        pid = local_args['id']
        dm.open(pid)
        return send_form_res(msg='ok')
    send_form_res(400, '��������')


@app.route('/intelligence', methods=['GET'])
def get_intelligence():
    global last_code
    global last_time
    global response_dict
    if not _can_auto_complete:
        return send_form_res(200, [])
    args = dict(request.args)
    try:
        cur_time = int(time.time())
        if last_code:
            if response_dict[last_code] == False:
                if cur_time - last_time < OUT_TIME_SECONDS:
                    return send_form_res(200, [])
        last_time = cur_time
        last_code = args['code']
        response_dict[last_code] = False
        if 'code' in args:
            if 'row' in args:
                if 'column' in args:
                    intelligences = autocomplete(args['code'], int(args['row']) + 1, int(args['column']))
                    response_dict[args['code']] = True
                    return send_form_res(200, intelligences)
        return send_form_res(400, 'ȱ�ٲ���')
    except Exception as e:
        try:
            return send_form_res(400, '��������:' + str(e))
        finally:
            e = None
            del e


def run_http(port):
    try:
        app.run(port=port, xes_hide_log=True)
    except Exception as e:
        try:
            push_log(Type.LOG, 0, traceback.format_exc())
        finally:
            e = None
            del e


def run_https(port, cert, key):
    try:
        app.run(port=port, ssl_context=(cert, key), xes_hide_log=True)
    except Exception as e:
        try:
            push_log(Type.LOG, 0, traceback.format_exc())
        finally:
            e = None
            del e
# okay decompiling handle_http.pyc
