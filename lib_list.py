# uncompyle6 version 3.8.0
# Python bytecode 3.7.0 (3394)
# Decompiled from: Python 3.8.5 (tags/v3.8.5:580fbb0, Jul 20 2020, 15:57:54) [MSC v.1924 64 bit (AMD64)]
# Embedded file name: build\Lib\site-packages\thonny\lib_list.py
# Compiled at: 2022-12-29 15:08:18
# Size of source mod 2**32: 22634 bytes
from collections import deque
from enum import Enum
from thonny.manage_package import pkg_manager, empty_process_manager
from thonny.package import Package, State, init_pack_with_dict
from thonny.common import is_client_call, PIP_NAMES
from thonny.port_helper import check
import requests
from threading import Thread, Lock
from thonny.common import pre_path, set_lib_obj, get_lib_obj
from thonny.log import push_log, Type
import pickle, os, asyncio, queue, json, time
must_type = 'must'
option_type = 'option'
cache_type = 'cache'
pip_names = {}
lock = Lock()
res_obj = None

def filter_ret_libs(origin_libs):
    """
    :功能:过滤返回前端的库列表，如xesrepair属于必备库，但是不显示给用户
    """
    import copy
    target_libs = copy.deepcopy(origin_libs)
    new_must_arr = []
    for lib in target_libs[must_type]:
        if lib.name != 'xesrepair':
            new_must_arr.append(lib)

    target_libs[must_type] = new_must_arr
    return target_libs


class PackageList:

    def __init__(self):
        self.state = State.installed
        self._queue = deque()
        self._tmp_queue = deque()
        self._cur_installing = None
        self.packages = {}
        self.packages[must_type] = [
         Package(name='xes-lib',
           desc='xes-lib是学而思编程发布的python库，可以实现很多炫酷功能，如短信发送、路径查询、天气预报、语音翻译等功能，持续更新中.....'), Package(name='qrcode', desc='一个二维码生成工具库。专属二维码了解一下。')]
        self.packages[option_type] = [Package(name='Pillow', desc='一个基础图像处理库，可以对图像切片、旋转、滤镜、输出文字、调色。'),
         Package(name='numpy',
           desc='我们怎么能缺少这么重要的库？它为Python提供了很多高级的数学方法。'), Package(name='algorithms', desc='一个 Python 算法模块，提供了常用的数据结构及算法。')]
        self.packages[cache_type] = []
        self._err_dic = {}
        self._name_dic = {}
        self._static_list = {}
        self._user_list = None
        self._desc_list = {}
        self._installed_err_que = deque()
        self._has_new_err = 0
        self.install_tags = {}
        self.install_pre_states = {}
        self._lock_id = None
        self._last_req_time = None
        for key, l in self.packages.items():
            for index, item in enumerate(l):
                self._name_dic[item.name] = {'pack_type':key, 
                 'index':index}

        new_thread = Thread(target=(self.auto_destory_state), daemon=True)
        new_thread.start()

    def load_local(self):
        global res_obj
        local_pkg = pkg_manager.get_local_list(True)
        self._user_list = local_pkg['user']
        user_name_dic = {}
        for pack in self._user_list:
            user_name_dic[pack.name] = 1
            if pack.name in self._err_dic:
                self.remove_err_pack(pack.name)
            if pack.name in self._name_dic:
                opt_type = self._name_dic[pack.name]['pack_type']
            if opt_type == must_type:
                serv_pack = self.get_package_by_name(pack.name)
                if serv_pack.version is not None:
                    if serv_pack.version != '':
                        if pack.version != serv_pack.version and not is_client_call():
                            if 'open' in res_obj['data']:
                                if res_obj['data']['open'] == 1:
                                    self.uninstall_handler(pack.name)
                self.change_state_by_name(pack.name, State.installed)

        for pack in local_pkg['lib']:
            self._static_list[pack.name] = 1

    def check_must(self):
        for must_pack in self.packages[must_type]:
            if must_pack.state == State.not_installed.value:
                push_log(Type.LOG, 0, 'need install {}'.format(must_pack.name))
                try:
                    self.install_handler(name=(must_pack.name),
                      version=(must_pack.version),
                      desc=(must_pack.desc),
                      page_id=None)
                except Exception as e:
                    try:
                        push_log(Type.LOG, 0, 'must install err {}'.format(e))
                    finally:
                        e = None
                        del e

    def update_pack_data(self, json_res):
        global pip_names
        try:
            tmp_name_dic = {}
            tmp_packages = {must_type: [], option_type: []}
            pip_names = json_res['data']['pip_names']
            for key, l in json_res['data']['libs'].items():
                for index, dic in enumerate(l):
                    pack = init_pack_with_dict(dic)
                    tmp_name_dic[pack.name] = {'pack_type':key, 
                     'index':index}
                    tmp_packages[key].append(pack)

            self._name_dic = tmp_name_dic
            self.packages[must_type] = tmp_packages[must_type]
            self.packages[option_type] = tmp_packages[option_type]
            for index, pack in enumerate(self.packages[cache_type]):
                self._name_dic[pack.name] = {'pack_type':cache_type, 
                 'index':index}

        except Exception as e:
            try:
                push_log((Type.LOG), status=0, msg=e)
            finally:
                e = None
                del e

    def load_desc(self):
        desc_path = os.path.join(pre_path, 'desc.txt')
        if not os.path.exists(desc_path):
            f = open(desc_path, 'wb')
            pickle.dump({}, f, -1)
            f.close()
        else:
            f = open(desc_path, 'rb')
            self._desc_list = pickle.load(f)
            f.close()
            need_show = []
            if self._user_list is None:
                local_pkg = pkg_manager.get_local_list()['user']
            else:
                local_pkg = self._user_list
        for pack in local_pkg:
            if pack.name not in self._desc_list:
                need_show.append(pack.name)

        if len(need_show) > 0:
            self.check_pack_desc(need_show)

    def get_pack_show(self, name):
        show_dict = pkg_manager.get_module_info(name)
        if 'Summary' in show_dict:
            summary = show_dict['Summary']
            self._desc_list[name] = summary

    def check_pack_desc(self, show_list):
        for name in show_list:
            if name not in self._desc_list:
                self.get_pack_show(name)

        with lock:
            desc_path = os.path.join(pre_path, 'desc.txt')
            f = open(desc_path, 'wb')
            pickle.dump(self._desc_list, f, -1)
            f.close()

    def change_state_by_name(self, name, state):
        if state == State.installing:
            self._cur_installing = name
        pack_type = self._name_dic[name]['pack_type']
        index = self._name_dic[name]['index']
        self.packages[pack_type][index].change_state(state)

    def get_package_by_name(self, name):
        pack_type = self._name_dic[name]['pack_type']
        index = self._name_dic[name]['index']
        return self.packages[pack_type][index]

    def get_state_by_name(self, name):
        return self.get_state_by_name(name).state

    def get_pack_list(self, page_id):
        can_use = self.check_lock(page_id)
        if not can_use:
            return False
        res = {}
        res['state'] = self.state.value
        local_pkg = pkg_manager.get_local_list(True)
        option_list = local_pkg['user']
        local_list = local_pkg['lib']
        need_show = []
        last_option_list = []
        filtered_list = []
        need_filter_keys = {}
        for pack in local_list:
            need_filter_keys[pack.name] = 1

        for pack in option_list:
            if pack.name not in need_filter_keys:
                filtered_list.append(pack)

        for pack in filtered_list:
            if pack.name in self._err_dic:
                self.remove_err_pack(pack.name)
            if pack.name in self._name_dic:
                opt_type = self._name_dic[pack.name]['pack_type']
                if opt_type == must_type or opt_type == option_type:
                    self.change_state_by_name(pack.name, State.installed)
                else:
                    if pack.name in self._desc_list:
                        pack.desc = self._desc_list[pack.name]
                    else:
                        need_show.append(pack.name)
                    last_option_list.append(pack)
            else:
                if pack.name in self._desc_list:
                    pack.desc = self._desc_list[pack.name]
                else:
                    need_show.append(pack.name)
                last_option_list.append(pack)
                self._name_dic[pack.name] = {'pack_type':'cache', 
                 'index':len(self.packages[cache_type])}
                self.packages[cache_type].append(pack)

        res[must_type] = self.packages[must_type].copy()
        res[option_type] = self.packages[option_type].copy()
        res[option_type].extend(last_option_list)
        res['state'] = self.state.value
        if len(need_show) > 0:
            update_thread = Thread(target=(self.check_pack_desc),
              args=(need_show,),
              daemon=True)
            update_thread.start()
        res = filter_ret_libs(res)
        return res

    def get_err_list(self):
        res = []
        for name in self._err_dic:
            cache = self._name_dic[name]
            res.append(self.packages[cache['pack_type']][cache['index']])

        return res

    def auto_destory_state(self):
        time.sleep(1)
        while True:
            now = time.time()
            if not self.state == State.installing or self._last_req_time is None or now - self._last_req_time > 1:
                self.get_state('')
                time.sleep(0.3)
            else:
                time.sleep(1)

    def get_state(self, pre, is_req=False):
        if is_req:
            self._last_req_time = time.time()
        else:
            res = pkg_manager.get_process()
            if res is None:
                res = empty_process_manager
                res.all_state = self.state.value
                res.err_count = len(self._err_dic)
                cur_cnt = 0
                if self._cur_installing is not None:
                    cur_cnt = 1
                else:
                    res.installing_count = cur_cnt + len(self._queue)
                    res.desc = ''
                    res.has_new_err = False
                    res.tag = None
                    return res
                    res.err_count = len(self._err_dic)
                    res.installing_count = 1 + len(self._queue)
                    res.all_state = State.installing.value
                    name = res.name
                    res.desc = self.get_package_by_name(name).desc
                    if res.state == State.installed.value:
                        if name in self._err_dic:
                            self._err_dic.pop(name)
                        self.change_state_by_name(name, State.installed)
                        self.check_next()
                        res.all_state = self.state.value
                        self._installed_err_que.append(res)
                    else:
                        if res.state == State.err.value:
                            self._has_new_err = 1
                            self._err_dic[name] = self._name_dic[name]
                            self.change_state_by_name(name, State.err)
                            self.check_next()
                            res.all_state = self.state.value
                            self._installed_err_que.append(res)
                        else:
                            res.all_state = self.state.value
                if self._has_new_err == 2:
                    res.has_new_err = True
                    self._has_new_err = 0
            else:
                res.has_new_err = False
        res.tag = self.install_tags[name]
        return res

    def check_lock(self, page_id):
        if self.state == State.installing:
            if self._lock_id is None:
                self._lock_id = page_id
                return True
            if self._lock_id == page_id:
                return True
            if page_id == None:
                return True
            return False
        else:
            self._lock_id = None
            return True

    def unlock(self, page_id):
        if self._lock_id == page_id:
            self._lock_id = None

    def get_all_state(self, page_id):
        can_use = self.check_lock(page_id)
        if not can_use:
            return False
        res = {}
        res['all_state'] = self.state.value
        res['err_count'] = len(self._err_dic)
        cur_cnt = 0
        if self._cur_installing is not None:
            cur_cnt = 1
        res['installing_count'] = cur_cnt + len(self._queue)
        return res

    def check_next(self):
        if self._queue:
            nextp = self._queue.popleft()
            self._cur_installing = nextp
            self.change_state_by_name(nextp, State.installing)
            pack = self.get_package_by_name(nextp)
            pkg_manager.handle_install(pack)
        else:
            self._cur_installing = None
            if len(self._err_dic):
                if self._has_new_err == 1:
                    self._has_new_err = 2
                else:
                    self._has_new_err = 0
                self.state = State.err
            else:
                self.state = State.installed

    def install_handler(self, name, page_id, version='', desc='', first=False, tag=None):
        self.install_tags[name] = tag
        if name != 'xesrepair':
            self.state = State.installing
        else:
            can_use = self.check_lock(page_id)
            return can_use or False
        if name not in self._name_dic:
            self.install_pre_states[name] = State.not_installed
            cache_pack = Package(name=name, desc=desc)
            self.packages[cache_type].append(cache_pack)
            self._name_dic[name] = {'pack_type':'cache',  'index':len(self.packages[cache_type]) - 1}
        else:
            pack_type = self._name_dic[name]['pack_type']
            index = self._name_dic[name]['index']
            cache_pack = self.packages[pack_type][index]
            self.install_pre_states[name] = State.not_installed
            if cache_pack.state == State.err.value:
                self.install_pre_states[name] = State.err
        if self._queue or self._cur_installing is not None:
            if first:
                self._queue.appendleft(name)
            else:
                self._queue.append(name)
            self.change_state_by_name(name, State.waiting)
            return State.waiting.value
        self.change_state_by_name(name, State.installing)
        pkg_manager.handle_install(cache_pack)
        return State.installing.value

    def cancel_install_handler(self, name):
        pre_state = self.install_pre_states[name]
        self.change_state_by_name(name, self.install_pre_states[name])
        if name == self._cur_installing:
            pkg_manager.handle_cancel_install()
            self.check_next()
        else:
            while self._queue:
                top = self._queue.popleft()
                if top == name:
                    break
                else:
                    self._tmp_queue.append(top)

            while self._tmp_queue:
                top = self._tmp_queue.pop()
                self._queue.appendleft(top)

        return pre_state.value

    def _filter_search_list(self, old_search_list, search_name):
        """
        对搜索列表进行过滤，根据库名映射配置优先展示必备库
        :params old_search_list 已有的返回
        :params search_name 搜索库名
        """
        for package in old_search_list:
            if package.name == 'xes':
                old_search_list.remove(package)
                break

        if search_name not in pip_names:
            return old_search_list
        for package in old_search_list:
            if package.name == pip_names[search_name]:
                return old_search_list

        for package in self._user_list:
            if package.name == pip_names[search_name]:
                old_search_list.insert(0, package)
                return old_search_list

        return old_search_list

    def search_handler(self, name, flag):
        if flag and name in self._name_dic:
            res_list = [
             self.get_package_by_name(name)]
        else:
            res_list = pkg_manager.handle_search(name, flag)
            if flag == False:
                res_list = self._filter_search_list(res_list, name)
        res = {must_type: [], option_type: []}
        for pack in res_list:
            if pack.name in self._static_list:
                pack.state = State.builtin.value
                res[option_type].append(pack)
            elif pack.name in self._name_dic:
                cache_pack = self.get_package_by_name(pack.name)
                if self._name_dic[pack.name]['pack_type'] == must_type:
                    res[must_type].append(cache_pack)
                else:
                    res[option_type].append(cache_pack)
            else:
                res[option_type].append(pack)
            if flag:
                self.packages[cache_type].append(pack)
                self._name_dic[pack.name] = {'pack_type':'cache', 
                 'index':len(self.packages[cache_type]) - 1}

        return res

    def uninstall_handler(self, name):
        if name in self._name_dic:
            pkg_manager.handle_uninstall(name)
            self.change_state_by_name(name, State.not_installed)

    def remove_err_pack(self, name):
        if name in self._err_dic:
            cache = self._name_dic[name]
            self.packages[cache['pack_type']][cache['index']].state = State.not_installed.value
            self._err_dic.pop(name)
            if not self._queue:
                if len(self._err_dic) == 0:
                    self.state = State.installed


pack_list = PackageList()

def load_origin_pack():
    new_thread = Thread(target=req_origin_pack, daemon=True)
    new_thread.start()
    load_thread = Thread(target=(pack_list.load_desc), daemon=True)
    load_thread.start()


def req_origin_pack():
    global res_obj
    url = 'http://code.xueersi.com/api/python/libs'
    res = requests.get(url, timeout=10)
    if res.status_code == 200:
        res_obj = res.json()
        pkg_manager.set_lib_obj(res_obj)
        set_lib_obj(res_obj)
        pack_list.update_pack_data(res_obj)
        pack_list.load_local()
        if not is_client_call():
            if not 'open' in res_obj['data'] or res_obj['data']['open'] == 1:
                pack_list.check_must()
    else:
        pack_list.load_local()
# okay decompiling lib_list.pyc
