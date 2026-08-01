#!/bin/bash
# GameServerManager3 Install Script.
# By tzdtwsj.

echo "========================================"
cat << EOF
  ___ ___ __  __                            ____
 / __/ __|  \/  |__ _ _ _  __ _ __ _ ___ _ |__ /
| (_ \__ \ |\/| / _\` | ' \/ _\` / _\` / -_) '_|_ \ 
 \___|___/_|  |_\__,_|_||_\__,_\__, \___|_||___/
                               |___/
EOF
echo "GSManager3安装脚本 By tzdtwsj"
echo "开源地址：https://github.com/jianbaobao/GameServerManager"
echo "========================================"

if test "$(id -u)" != "0"; then
	echo -e "\x1b[31m请使用root用户安装！\x1b[0m"
	exit 1
fi

echo "询问信息阶段"

while true;do
echo "请选择安装方式"
echo "1.常规安装"
echo "2.Docker安装（推荐）"
read -p "(回车默认2):" input
case $input in
	1)install_type=1;;
	2|"")install_type=2;;
	*)continue;;
esac
break
done

if test "$install_type" = "2"; then
	if test "$(command -v docker)" = ""; then
		echo -e "\x1b[31m没有安装docker，不能使用该安装方式！\x1b[0m"
		echo -e "\x1b[33m提示: 如果你是红帽系/deb系的系统，你可以以root权限手动运行这一长串命令安装docker: \x1b[32mcurl -fsSL https://ghfast.top/https://github.com/docker/docker-install/raw/master/install.sh | DOWNLOAD_URL=https://mirrors.tuna.tsinghua.edu.cn/docker-ce bash\n\x1b[33m需要注意不同的发行版安装docker方式不同\x1b[0m"
		exit 1
	fi
	while true;do
	echo "请选择容器的网络类型"
	echo "1.bridge"
	echo "2.host"
	read -p "(回车默认host):" input
	case $input in
		1|bridge)docker_net_type=bridge;;
		2|host|"")docker_net_type=host;;
		*)echo "无效输入";continue;;
	esac
	break
	done
	echo "使用镜像站拉取镜像吗？将会使用1毫秒镜像站"
	read -p "(Y/n):" input
	case "$input" in
		N|n|no|No)docker_use_mirror=no;;
		Y|y|yes|YES|*)docker_use_mirror=yes;;
	esac
else
	if test -x /usr/bin/systemctl || test -x /bin/systemctl; then
	echo "安装到系统服务systemd吗？这样就可以实现开机自启和后台托管GSM3"
	read -p "(Y/n):" input
	case "$input" in
		N|n|no|NO)install_to_systemd=no;;
		Y|y|yes|YES|*)install_to_systemd=yes;;
	esac
	fi
fi

echo "请输入安装路径"
read -p "(回车默认/opt/gsmanager3):" install_path
if test "$install_path" = ""; then install_path="/opt/gsmanager3"; fi

echo "请输入服务访问端口"
read -p "(回车默认3001):" server_port
if test "$server_port" = ""; then
	server_port=3001
fi

echo "========================================"
echo "设置初始管理员密码（至少6位，用于首次登录面板）"
admin_password=""
while test ${#admin_password} -lt 6; do
	read -s -p "请输入管理员初始密码（至少6位，输入为空则自动生成随机密码）: " admin_password
	echo ""
	if test -z "$admin_password"; then
		echo "未输入，将自动生成随机密码（见服务日志）"
		break
	fi
	if test ${#admin_password} -lt 6; then
		echo "密码太短，至少6位，请重新输入"
		admin_password=""
	fi
done

echo 信息确认阶段
echo "========================================"
echo -n "安装方式："
if test "$install_type" = "1"; then
	echo "常规安装"
	echo "安装到systemd(开机自启)：$install_to_systemd"
elif test "$install_type" = "2"; then
	echo "Docker安装(默认已启用开机自启)"
	echo "网络类型：$docker_net_type"
fi
echo "访问端口：$server_port"
echo "安装路径：$install_path"
echo "========================================"

echo -e "\n"
echo "如果没有任何问题请直接按下回车安装，不要输入任何内容(或等15s)，否则请执行^C"
read -t 15 input
if test "$?" != "142" && test "$input" != ""; then
        echo "退出安装..."
	exit
fi
echo "开始安装..."
mkdir -pv "$install_path"
cd "$install_path"

# GitHub 下载镜像源列表（自动回退）
GITHUB_MIRRORS=(
  "https://gh.api.99988866.xyz/https://github.com"
  "https://ghfast.top/https://github.com"
  "https://ghproxy.net/https://github.com"
  "https://ghproxy.com/https://github.com"
  "https://hub.fastgit.xyz/https://github.com"
  "https://github.moeyy.xyz/https://github.com"
  "https://dgithub.xyz/https://github.com"
  "https://github.com"  # 官方直连（最后尝试）
)

# 带镜像回退的下载函数
download_with_mirror() {
  local file_url="$1"
  local output_file="$2"
  local downloader
  local mirror_url

  if command -v curl &>/dev/null; then
    downloader="curl -kLo"
  elif command -v wget &>/dev/null; then
    downloader="wget --no-check-certificate -O"
  else
    echo -e "\x1b[31m错误：未找到 curl 或 wget，无法下载\x1b[0m"
    return 1
  fi

  # 从第一个镜像开始尝试，失败后自动切换到下一个
  for mirror in "${GITHUB_MIRRORS[@]}"; do
    mirror_url="${mirror}${file_url}"
    echo -e "\x1b[33m正在尝试镜像: ${mirror}\x1b[0m"
    if $downloader "$output_file" "$mirror_url" 2>/dev/null; then
      if [ -f "$output_file" ] && [ -s "$output_file" ]; then
        echo -e "\x1b[32m下载成功！\x1b[0m"
        return 0
      fi
    fi
    echo -e "\x1b[31m镜像失败，切换下一个...\x1b[0m"
    rm -f "$output_file" 2>/dev/null
  done

  echo -e "\x1b[31m所有镜像源都下载失败，请检查网络连接后重试\x1b[0m"
  return 1
}

if test "$install_type" = "1"; then
  # 下载 GitHub Release 压缩包（自动多镜像回退）
  GH_RELEASE_PATH="/jianbaobao/GameServerManager/releases/latest/download/gsm3-management-panel-linux.tar.gz"

  if download_with_mirror "$GH_RELEASE_PATH" "gsm3.tgz"; then
    echo "下载完毕，解压中，请稍等"
  else
    rm -rf gsm3.tgz
    exit 1
  fi
	echo "下载完毕，解压中，请稍等"
	tar -xzf gsm3.tgz -C "$install_path"
	rm -rf gsm3.tgz
	chmod 755 "$install_path/node/bin/node" "$install_path/start.sh" 2>/dev/null || true

	# 验证并修复PTY二进制文件
	ARCH=$(uname -m)
	if [ "$ARCH" = "x86_64" ]; then
		PTY_NAME="pty_linux_x64"
	elif [ "$ARCH" = "aarch64" ]; then
		PTY_NAME="pty_linux_arm64"
	else
		PTY_NAME=""
	fi

	if [ -n "$PTY_NAME" ]; then
		PTY_FILE="$install_path/data/lib/$PTY_NAME"
		PTY_VALID=false

		# 检查PTY文件是否存在且为有效的ELF二进制文件
		if [ -f "$PTY_FILE" ]; then
			if file "$PTY_FILE" 2>/dev/null | grep -q "ELF"; then
				PTY_VALID=true
			else
				echo -e "\x1b[33mPTY文件无效（非ELF二进制），将重新下载...\x1b[0m"
				rm -f "$PTY_FILE"
			fi
		fi

		if [ "$PTY_VALID" = "false" ]; then
			echo -e "\x1b[33m正在下载PTY二进制文件...\x1b[0m"
			mkdir -p "$install_path/data/lib"
			PTY_RELEASE_PATH="/MCSManager/PTY/releases/download/latest/$PTY_NAME"
			if download_with_mirror "$PTY_RELEASE_PATH" "$PTY_FILE"; then
				echo "PTY 下载完成"
			else
				echo -e "\x1b[33mPTY 下载失败，继续安装流程...\x1b[0m"
			fi
			if [ -f "$PTY_FILE" ] && file "$PTY_FILE" 2>/dev/null | grep -q "ELF"; then
				echo -e "\x1b[32mPTY下载完成\x1b[0m"
			else
				echo -e "\x1b[33mPTY下载失败，终端功能将在服务启动时自动重试下载\x1b[0m"
				rm -f "$PTY_FILE" 2>/dev/null
			fi
		fi

		# 设置可执行权限
		if [ -f "$PTY_FILE" ]; then
			chmod 755 "$PTY_FILE"
		fi
	fi

	# 设置其他lib文件权限
	chmod 755 "$install_path"/data/lib/file_zip_* "$install_path"/data/lib/7z_* 2>/dev/null || true
	chmod -R 777 "$install_path" 2>/dev/null || true

	echo "SERVER_PORT=$server_port" >> "$install_path/.env"
	if test -n "$admin_password"; then
		echo "ADMIN_PASSWORD=$admin_password" >> "$install_path/.env"
	fi
	if test "$install_to_systemd" = "yes"; then
		mkdir -pv /usr/local/lib/systemd/system
		echo -e "\x1b[33m正在安装systemd服务...\x1b[0m"
		cat > /usr/local/lib/systemd/system/gsm3.service <<EOF
[Unit]
Description=GameServerManager 3
After=network.target

[Service]
Type=simple
WorkingDirectory=$install_path
ExecStart=$install_path/node/bin/node server/index.js
Restart=on-failure

[Install]
WantedBy=multi-user.target
EOF
		systemctl daemon-reload
		systemctl enable --now gsm3
		echo "安装完成，已自动帮你启动GSM3，并且已启用自启，访问机器ip加端口$server_port即可开始使用GSM3，使用方式："
		echo -e "启动gsm3：\x1b[32msystemctl start gsm3\x1b[0m"
		echo -e "停止gsm3：\x1b[32msystemctl stop gsm3\x1b[0m"
		echo -e "启用开机自启：\x1b[32msystemctl enable gsm3\x1b[0m"
		echo -e "禁用开机自启：\x1b[32msystemctl disable gsm3\x1b[0m"
		echo -e "一键卸载gsm3命令：\x1b[31msystemctl stop gsm3&&systemctl disable gsm3&&systemctl daemon-reload&&rm -rf \"$install_path\" /usr/local/lib/systemd/system/gsm3.service\x1b[0m"
	else
		echo "安装完成，需要你手动启动，启动方式："
		echo -e "\x1b[32mcd '$install_path'; ./start.sh\x1b[0m"
		echo "如果想要后台运行，请安装screen，并使用该命令："
		echo -e "\x1b[32mscreen -dmS gsm3 bash -c \"cd '$install_path'; ./start.sh\"\x1b[0m"
		echo "启动后，访问机器ip加端口$server_port即可开始使用GSM3"
		echo -e "一键卸载gsm3命令：\x1b[31mrm -rf \"$install_path\"\x1b[0m"
	fi
elif test "$install_type" = "2"; then
	cat > docker-compose.yml <<EOF
services:
  gsm3:
    container_name: GSManager3
    image: xiaozhu674/gameservermanager:latest
    user: root
    network_mode: $docker_net_type
    ports:
      # GSM3管理面板端口
      - "$server_port:$server_port"
      # 游戏端口，按需映射
      - "27015:27015"
    volumes:
    #steam用户数据目录 不建议修改
      - $install_path/game_data:/home/steam/.config
      - $install_path/game_data:/home/steam/.local
      - $install_path/game_file:/home/steam/games
    #root用户数据目录 不建议修改
      - $install_path/game_data:/root/.config
      - $install_path/game_data:/root/.local
      - $install_path/game_file:/root/steam/games
    #面板数据，请勿改动
      - $install_path/gsm3_data:/root/server/data
    environment:
      - TZ=Asia/Shanghai
      - SERVER_PORT=$server_port
    stdin_open: true
    tty: true
    restart: unless-stopped
EOF
	echo "已生成docker-compose.yml"
	mkdir game_data game_file gsm3_data
	chmod 777 game_data game_file
	if test "$docker_use_mirror" = "yes"; then
		docker pull docker.1ms.run/xiaozhu674/gameservermanager:latest
		if test "$?" != "0"; then echo -e "\x1b[31mdocker镜像拉取失败\x1b[0m"; exit 1; fi
		docker tag docker.1ms.run/xiaozhu674/gameservermanager:latest xiaozhu674/gameservermanager:latest
		docker rmi docker.1ms.run/xiaozhu674/gameservermanager:latest
	else
		docker pull xiaozhu674/gameservermanager:latest
		if test "$?" != "0"; then echo -e "\x1b[31mdocker镜像拉取失败\x1b[0m"; exit 1; fi
	fi
	echo -e "\x1b[32m镜像拉取完成，现在，请复制\x1b[33m启动命令\x1b[32m，粘贴并按下回车，然后访问机器的ip地址加上端口$server_port，开始使用GSManager3吧\x1b[0m"
	echo -e "启动命令：\x1b[33mcd '$install_path'; docker compose up -d\x1b[0m"
	echo -e "停止命令：\x1b[33mcd '$install_path'; docker compose down\x1b[0m"
	echo -e "一键卸载命令：\x1b[31mcd '$install_path'; docker compose down; docker rmi xiaozhu674/gameservermanager:latest\x1b[0m"
	chmod -R 777 "$install_path" 2>/dev/null || true
fi
