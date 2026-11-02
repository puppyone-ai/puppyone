#include <node_api.h>
#include <cerrno>
#include <cstdio>
#include <cstring>
#include <string>
#if defined(__linux__)
#include <fcntl.h>
#include <linux/fs.h>
#include <sys/syscall.h>
#include <unistd.h>
#endif

static bool ReadPath(napi_env env, napi_value value, std::string &result) {
  size_t size = 0;
  if (napi_get_value_string_utf8(env, value, nullptr, 0, &size) != napi_ok || !size) return false;
  result.resize(size + 1);
  if (napi_get_value_string_utf8(env, value, result.data(), result.size(), &size) != napi_ok) return false;
  result.resize(size);
  return result.find('\0') == std::string::npos;
}

static napi_value Publish(napi_env env, napi_callback_info info) {
  size_t count = 2;
  napi_value args[2];
  napi_get_cb_info(env, info, &count, args, nullptr, nullptr);
  std::string source, target;
  if (count != 2 || !ReadPath(env, args[0], source) || !ReadPath(env, args[1], target)) {
    napi_throw_type_error(env, "EINVAL", "Two filesystem paths are required.");
    return nullptr;
  }
#if defined(__APPLE__)
  int result = renamex_np(source.c_str(), target.c_str(), RENAME_EXCL);
#elif defined(__linux__)
  int result = syscall(SYS_renameat2, AT_FDCWD, source.c_str(), AT_FDCWD, target.c_str(), RENAME_NOREPLACE);
#else
  errno = ENOTSUP;
  int result = -1;
#endif
  if (result != 0) {
    int number = errno;
    const char *code = number == EEXIST || number == ENOTEMPTY ? "EEXIST"
      : number == ENOENT ? "ENOENT" : number == EXDEV ? "EXDEV"
      : number == EACCES ? "EACCES" : "PUBLISH_FAILED";
    napi_throw_error(env, code, strerror(number));
    return nullptr;
  }
  napi_value resultValue;
  napi_get_undefined(env, &resultValue);
  return resultValue;
}

static napi_value Init(napi_env env, napi_value exports) {
  napi_value publish;
  napi_create_function(env, "publish", NAPI_AUTO_LENGTH, Publish, nullptr, &publish);
  napi_set_named_property(env, exports, "publish", publish);
  return exports;
}
NAPI_MODULE(NODE_GYP_MODULE_NAME, Init)
