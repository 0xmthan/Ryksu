B = open('F:\Code\FatEcat-E\Olds\\blocks\\names.txt', 'r')
fx = open('F:\Code\FatEcat-E\Olds\\blocks\c.txt', 'w')
row_list = B.read().split("\n")
f = row_list
i = 0
while i < 25:
    fx.write("if (data == '"+f[i]+"') ()"+"\n")
    i = i + 1
